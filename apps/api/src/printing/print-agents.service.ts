import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  PRINTER_STATUSES,
  PRINT_PAIRING_CODE_TTL_MS,
  type PrinterStatus,
  normalizePairingCode,
} from "@repo/domain/printing";

import { AuditService } from "../audit/audit.service";
import {
  OrgsRepository,
  PrintAgentsRepository,
  PrintersRepository,
} from "../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../database/operator-context";
import { TransactionService } from "../database/transaction";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type PrintAgentsInput,
} from "./dto/printing.input";
import type {
  PrintAgentModel,
  PrintAgentPairingPayload,
  PrintAgentsPayload,
} from "./models/printing.model";
import {
  agentOperator,
  generateAgentKey,
  generatePairingCode,
  hashSecret,
  internalReader,
  parseObjectId,
} from "./print-agent-credentials";
import { PrintAgentReleaseService } from "./print-agent-release.service";
import { PrintJobsService } from "./print-jobs.service";
import { conflictError, fieldError, notFoundError } from "./printing-error";
import { type AgentRecord, pageOf, toAgentModel } from "./printing-mapper";

/** 審計動作名(printers.md「審計」);`targetType` 一律 `print_agent`。 */
const AUDIT_TARGET_TYPE = "print_agent";
const AUDIT = {
  create: "print-agent.create",
  resetPairing: "print-agent.reset-pairing",
  disable: "print-agent.disable",
} as const;

const NAME_MAX_LENGTH = 100;
const VERSION_MAX_LENGTH = 32;

/** 配對成功:回給代理程式的金鑰(只有這一次)。 */
export interface PairedAgent {
  agent: AgentRecord;
  key: string;
}

/**
 * 代理程式(docs/modules/printers.md):
 *
 * - 新增 → 8 碼配對碼(10 分鐘)→ 代理程式用它換長期金鑰;配對碼與金鑰都只存雜湊。
 * - **配對**是一次條件更新:「配對碼雜湊相符、未過期、啟用中」→ 寫入金鑰雜湊並清掉配對碼,
 *   所以過期、用過(含兩台同時用同一碼)都失敗。
 * - **重新配對**:清掉金鑰(舊金鑰立即失效)、產生新配對碼;印表機設定保留。
 * - **停用**:清掉金鑰與配對碼、旗下印表機不能選、等待中的工作標失敗;停用後不能再配對。
 * - 金鑰的驗證每個請求都查資料庫(`authenticate`),撤銷即時生效。
 */
@Injectable()
export class PrintAgentsService {
  constructor(
    private readonly agents: PrintAgentsRepository,
    private readonly printers: PrintersRepository,
    private readonly orgs: OrgsRepository,
    private readonly jobs: PrintJobsService,
    private readonly release: PrintAgentReleaseService,
    private readonly transactions: TransactionService,
    private readonly audit: AuditService,
  ) {}

  // ---- 後台(GraphQL)----

  async list(
    operator: OperatorContext,
    input: PrintAgentsInput,
  ): Promise<PrintAgentsPayload> {
    const { page, pageSize, skip } = pageOf(
      input,
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );
    const filter: Record<string, unknown> = {};
    if (input.orgId) {
      filter.orgId = parseObjectId(input.orgId) ?? new Types.ObjectId();
    }
    if (input.includeDisabled !== true) {
      filter.enabled = true;
    }
    const totalCount = await this.agents.count(operator, filter);
    const documents = await this.agents.findMany(operator, filter, {
      sort: { createdAt: -1, _id: -1 },
      skip,
      limit: pageSize,
    });
    const isOutdated = await this.release.outdatedChecker();
    const now = new Date();
    return {
      items: documents.map((agent) => toAgentModel(agent, now, isOutdated)),
      totalCount,
      page,
      pageSize,
    };
  }

  /** 新增代理程式:分店須在可見範圍內;回配對碼(只這一次)。 */
  async create(
    operator: OperatorContext,
    input: { orgId: string; name: string },
  ): Promise<PrintAgentPairingPayload> {
    const name = requireName(input.name);
    const orgId = parseObjectId(input.orgId);
    const org =
      orgId === null || !isOrgVisible(operator, orgId)
        ? null
        : await this.orgs.findById(internalReader(), orgId);
    if (org === null || orgId === null) {
      throw fieldError("orgId", "INVALID", "org not found");
    }
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + PRINT_PAIRING_CODE_TTL_MS);
    const agent = await this.transactions.withTransaction(async () => {
      const created = await this.agents.create(operator, {
        orgId,
        name,
        keyHash: null,
        pairingCodeHash: hashSecret(code),
        pairingExpiresAt: expiresAt,
        lastSeenAt: null,
        version: null,
        enabled: true,
      });
      await this.audit.record(operator, {
        action: AUDIT.create,
        targetType: AUDIT_TARGET_TYPE,
        targetId: created._id,
        after: { orgId: String(orgId), name },
      });
      return created;
    });
    return this.pairingPayload(agent, code, expiresAt);
  }

  /** 重新配對:舊金鑰立即失效、產生新配對碼(10 分鐘);已停用的不行(`CONFLICT AGENT_DISABLED`)。 */
  async resetPairing(
    operator: OperatorContext,
    id: string,
  ): Promise<PrintAgentPairingPayload> {
    const current = await this.mustFind(operator, id);
    if (!current.enabled) {
      throw conflictError(`print agent is disabled: ${id}`, "AGENT_DISABLED");
    }
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + PRINT_PAIRING_CODE_TTL_MS);
    const agent = await this.transactions.withTransaction(async () => {
      const updated = await this.agents.findOneAndUpdate(
        operator,
        { _id: current._id, enabled: true },
        {
          $set: {
            keyHash: null,
            pairingCodeHash: hashSecret(code),
            pairingExpiresAt: expiresAt,
          },
        },
      );
      if (updated === null) {
        throw conflictError(`print agent is disabled: ${id}`, "AGENT_DISABLED");
      }
      await this.audit.record(operator, {
        action: AUDIT.resetPairing,
        targetType: AUDIT_TARGET_TYPE,
        targetId: updated._id,
      });
      return updated;
    });
    return this.pairingPayload(agent, code, expiresAt);
  }

  /** 停用:金鑰與配對碼失效、等待中的工作標失敗(交易提交後各送 `print-result`)。 */
  async disable(
    operator: OperatorContext,
    id: string,
  ): Promise<PrintAgentModel> {
    const current = await this.mustFind(operator, id);
    const agent = await this.transactions.withTransaction(async () => {
      const updated = await this.agents.updateById(operator, current._id, {
        $set: {
          enabled: false,
          keyHash: null,
          pairingCodeHash: null,
          pairingExpiresAt: null,
        },
      });
      if (updated === null) {
        throw notFoundError(`print agent not found: ${id}`);
      }
      if (current.enabled) {
        await this.jobs.failPendingOfAgent(operator, current._id);
        await this.audit.record(operator, {
          action: AUDIT.disable,
          targetType: AUDIT_TARGET_TYPE,
          targetId: updated._id,
          before: { enabled: true },
          after: { enabled: false },
        });
      }
      return updated;
    });
    return toAgentModel(
      agent,
      new Date(),
      await this.release.outdatedChecker(),
    );
  }

  /** 單筆(給印表機的 resolver 用:同分店檢查)。 */
  findForPrinter(
    operator: OperatorContext,
    id: Types.ObjectId,
  ): Promise<AgentRecord | null> {
    return this.agents.findById(operator, id);
  }

  // ---- 代理程式(HTTP)----

  /**
   * 配對碼換長期金鑰。一次條件更新:相符、未過期、啟用中才命中,同時清掉配對碼 ——
   * 過期、用過、亂猜都回 null(不區分原因)。
   */
  async pair(
    rawCode: unknown,
    version: unknown,
    now = new Date(),
  ): Promise<PairedAgent | null> {
    const code = normalizePairingCode(rawCode);
    if (code === null) {
      return null;
    }
    const key = generateAgentKey();
    const agent = await this.agents.findOneAndUpdate(
      internalReader(),
      {
        pairingCodeHash: hashSecret(code),
        pairingExpiresAt: { $gt: now },
        enabled: true,
      },
      {
        $set: {
          keyHash: hashSecret(key),
          pairingCodeHash: null,
          pairingExpiresAt: null,
          lastSeenAt: now,
          ...(isVersion(version) ? { version: version.trim() } : {}),
        },
      },
    );
    return agent === null ? null : { agent, key };
  }

  /** 以金鑰找啟用中的代理程式(每個請求都查;撤銷即時生效),並記一次 `lastSeenAt`。 */
  async authenticate(
    rawKey: string,
    now = new Date(),
  ): Promise<AgentRecord | null> {
    const key = rawKey.trim();
    if (key === "") {
      return null;
    }
    const agent = await this.agents.findOneAndUpdate(
      internalReader(),
      { keyHash: hashSecret(key), enabled: true },
      { $set: { lastSeenAt: now } },
    );
    return agent;
  }

  /** 心跳:回報版本與印表機狀態(不在自己名下的印表機忽略)。 */
  async heartbeat(
    agent: AgentRecord,
    body: unknown,
    now = new Date(),
  ): Promise<void> {
    const operator = agentOperator(agent.orgId);
    const { version, printers } = (body ?? {}) as {
      version?: unknown;
      printers?: unknown;
    };
    if (isVersion(version) && version.trim() !== agent.version) {
      await this.agents.updateById(operator, agent._id, {
        $set: { version: version.trim() },
      });
    }
    if (!Array.isArray(printers)) {
      return;
    }
    for (const entry of printers.slice(0, 50) as unknown[]) {
      const { id, status } = (entry ?? {}) as {
        id?: unknown;
        status?: unknown;
      };
      const printerId = parseObjectId(id);
      if (printerId === null || !isPrinterStatus(status)) {
        continue;
      }
      await this.printers.findOneAndUpdate(
        operator,
        { _id: printerId, agentId: agent._id },
        { $set: { status, statusAt: now } },
      );
    }
  }

  // ---- 內部 ----

  private async mustFind(
    operator: OperatorContext,
    id: string,
  ): Promise<AgentRecord> {
    const agentId = parseObjectId(id);
    const agent =
      agentId === null ? null : await this.agents.findById(operator, agentId);
    if (agent === null) {
      throw notFoundError(`print agent not found: ${id}`);
    }
    return agent;
  }

  private async pairingPayload(
    agent: AgentRecord,
    code: string,
    expiresAt: Date,
  ): Promise<PrintAgentPairingPayload> {
    return {
      agent: toAgentModel(
        agent,
        new Date(),
        await this.release.outdatedChecker(),
      ),
      pairingCode: code,
      pairingExpiresAt: expiresAt,
    };
  }
}

function requireName(value: string): string {
  const name = value.trim();
  if (name === "") {
    throw fieldError("name", "REQUIRED", "name is required");
  }
  if (name.length > NAME_MAX_LENGTH) {
    throw fieldError("name", "INVALID", "name is too long");
  }
  return name;
}

function isVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.trim().length <= VERSION_MAX_LENGTH
  );
}

function isPrinterStatus(value: unknown): value is PrinterStatus {
  return (
    typeof value === "string" &&
    (PRINTER_STATUSES as readonly string[]).includes(value)
  );
}
