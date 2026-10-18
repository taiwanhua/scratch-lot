import { Injectable } from "@nestjs/common";
import { Types } from "mongoose";

import {
  PRINTER_DEFAULT_PORT,
  PRINTER_PAPER_WIDTHS,
  type PrinterPaperWidth,
} from "@repo/domain/printing";

import { AuditService } from "../audit/audit.service";
import {
  PrintAgentsRepository,
  PrintersRepository,
} from "../database/database.module";
import {
  type OperatorContext,
  isOrgVisible,
} from "../database/operator-context";
import { TransactionService } from "../database/transaction";
import {
  type CreatePrinterInput,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type PrintersInput,
  type SetPrinterEnabledInput,
  type UpdatePrinterInput,
} from "./dto/printing.input";
import type {
  PrintablePrintersPayload,
  PrinterModel,
  PrintersPayload,
} from "./models/printing.model";
import { parseObjectId } from "./print-agent-credentials";
import {
  type PrintingFieldError,
  fieldError,
  notFoundError,
  validationError,
} from "./printing-error";
import {
  type AgentRecord,
  type PrinterRecord,
  pageOf,
  toPrinterModel,
} from "./printing-mapper";

const AUDIT_TARGET_TYPE = "printer";
const AUDIT = {
  create: "printer.create",
  edit: "printer.edit",
  toggleEnabled: "printer.toggle-enabled",
} as const;

const NAME_MAX_LENGTH = 100;
/** IPv4 或主機名(英數、連字號、點;不含協定與埠)。 */
const HOST_PATTERN =
  /^(?=.{1,253}$)[\dA-Za-z](?:[\dA-Za-z-]*[\dA-Za-z])?(?:\.[\dA-Za-z](?:[\dA-Za-z-]*[\dA-Za-z])?)*$/;

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function checkName(value: string, errors: PrintingFieldError[]): string {
  const name = value.trim();
  if (name === "") {
    errors.push({
      fieldKey: "name",
      code: "REQUIRED",
      message: "name is required",
    });
  } else if (name.length > NAME_MAX_LENGTH) {
    errors.push({
      fieldKey: "name",
      code: "INVALID",
      message: "name is too long",
    });
  }
  return name;
}

function checkHost(value: string, errors: PrintingFieldError[]): string {
  const host = value.trim();
  if (host === "") {
    errors.push({
      fieldKey: "host",
      code: "REQUIRED",
      message: "host is required",
    });
  } else if (!HOST_PATTERN.test(host)) {
    errors.push({
      fieldKey: "host",
      code: "INVALID",
      message: "host must be an IP address or host name",
    });
  }
  return host;
}

function checkPort(value: number, errors: PrintingFieldError[]): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    errors.push({
      fieldKey: "port",
      code: "INVALID",
      message: "port must be 1–65535",
    });
  }
  return value;
}

/**
 * 印表機:只記到分店層,分店 = 代理程式的分店。
 * 同一分店至多一台預設印表機(設新的預設時,同分店其他台改 false,同一個交易)。
 */
@Injectable()
export class PrintersService {
  constructor(
    private readonly printers: PrintersRepository,
    private readonly agents: PrintAgentsRepository,
    private readonly transactions: TransactionService,
    private readonly audit: AuditService,
  ) {}

  async list(
    operator: OperatorContext,
    input: PrintersInput,
  ): Promise<PrintersPayload> {
    const { page, pageSize, skip } = pageOf(
      input,
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );
    const filter: Record<string, unknown> = {};
    if (input.orgId) {
      filter.orgId = parseObjectId(input.orgId) ?? new Types.ObjectId();
    }
    if (input.agentId) {
      filter.agentId = parseObjectId(input.agentId) ?? new Types.ObjectId();
    }
    if (input.enabled !== undefined && input.enabled !== null) {
      filter.enabled = input.enabled;
    }
    const keyword = input.keyword?.trim();
    if (keyword) {
      const pattern = { $regex: escapeRegex(keyword), $options: "i" };
      filter.$or = [{ name: pattern }, { host: pattern }];
    }
    const totalCount = await this.printers.count(operator, filter);
    const documents = await this.printers.findMany(operator, filter, {
      sort: { createdAt: -1, _id: -1 },
      skip,
      limit: pageSize,
    });
    return {
      items: await this.toModels(operator, documents),
      totalCount,
      page,
      pageSize,
    };
  }

  /** 列印按鈕的選單:這家分店可選的印表機(啟用、代理程式啟用);不分頁。 */
  async printable(
    operator: OperatorContext,
    orgIdText: string,
  ): Promise<PrintablePrintersPayload> {
    const orgId = parseObjectId(orgIdText);
    if (orgId === null || !isOrgVisible(operator, orgId)) {
      return { items: [], totalCount: 0, defaultPrinterId: null };
    }
    const documents = await this.printers.findMany(
      operator,
      { orgId, enabled: true },
      { sort: { createdAt: 1, _id: 1 } },
    );
    const models = await this.toModels(operator, documents);
    const items = models.filter((printer) => printer.available);
    return {
      items,
      totalCount: items.length,
      defaultPrinterId: items.find((printer) => printer.isDefault)?.id ?? null,
    };
  }

  async create(
    operator: OperatorContext,
    input: CreatePrinterInput,
  ): Promise<PrinterModel> {
    const errors: PrintingFieldError[] = [];
    const name = checkName(input.name, errors);
    const host = checkHost(input.host, errors);
    const port = checkPort(input.port ?? PRINTER_DEFAULT_PORT, errors);
    const paperWidth = input.paperWidth ?? 58;
    if (!(PRINTER_PAPER_WIDTHS as readonly number[]).includes(paperWidth)) {
      errors.push({
        fieldKey: "paperWidth",
        code: "INVALID",
        message: `paperWidth must be one of ${PRINTER_PAPER_WIDTHS.join(", ")}`,
      });
    }
    const found = await this.findAgent(operator, input.agentId);
    // 已停用的代理程式不能再掛印表機(停用後金鑰失效,掛上去也印不出來)
    const agent = found?.enabled === true ? found : null;
    if (agent === null) {
      errors.push({
        fieldKey: "agentId",
        code: "INVALID",
        message: "print agent not found or disabled",
      });
    }
    if (errors.length > 0 || agent === null) {
      throw validationError(errors);
    }
    const isDefault = input.isDefault === true;
    const printer = await this.transactions.withTransaction(async () => {
      if (isDefault) {
        await this.clearDefault(operator, agent.orgId);
      }
      const created = await this.printers.create(operator, {
        orgId: agent.orgId,
        agentId: agent._id,
        name,
        host,
        port,
        paperWidth: paperWidth as PrinterPaperWidth,
        isDefault,
        enabled: true,
        status: null,
        statusAt: null,
      });
      await this.audit.record(operator, {
        action: AUDIT.create,
        targetType: AUDIT_TARGET_TYPE,
        targetId: created._id,
        after: { agentId: String(agent._id), name, host, port, isDefault },
      });
      return created;
    });
    return this.toModel(operator, printer);
  }

  /** 編輯:缺席 = 不動;`agentId` 只能換成同分店的代理程式。 */
  async update(
    operator: OperatorContext,
    input: UpdatePrinterInput,
  ): Promise<PrinterModel> {
    const current = await this.mustFind(operator, input.id);
    const errors: PrintingFieldError[] = [];
    const set: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== null) {
      set.name = checkName(input.name, errors);
    }
    if (input.host !== undefined && input.host !== null) {
      set.host = checkHost(input.host, errors);
    }
    if (input.port !== undefined && input.port !== null) {
      set.port = checkPort(input.port, errors);
    }
    if (input.agentId !== undefined && input.agentId !== null) {
      const agent = await this.findAgent(operator, input.agentId);
      if (agent?.orgId.equals(current.orgId)) {
        set.agentId = agent._id;
      } else {
        errors.push({
          fieldKey: "agentId",
          code: "INVALID",
          message: "print agent not found in this printer's org",
        });
      }
    }
    if (input.isDefault !== undefined && input.isDefault !== null) {
      set.isDefault = input.isDefault;
    }
    if (errors.length > 0) {
      throw validationError(errors);
    }
    const printer = await this.transactions.withTransaction(async () => {
      if (set.isDefault === true) {
        await this.clearDefault(operator, current.orgId);
      }
      const updated = await this.printers.updateById(operator, current._id, {
        $set: set,
      });
      if (updated === null) {
        throw notFoundError(`printer not found: ${input.id}`);
      }
      await this.audit.record(operator, {
        action: AUDIT.edit,
        targetType: AUDIT_TARGET_TYPE,
        targetId: updated._id,
        before: Object.fromEntries(
          Object.keys(set).map((key) => [
            key,
            String((current as unknown as Record<string, unknown>)[key]),
          ]),
        ),
        after: Object.fromEntries(
          Object.entries(set).map(([key, value]) => [key, String(value)]),
        ),
      });
      return updated;
    });
    return this.toModel(operator, printer);
  }

  async setEnabled(
    operator: OperatorContext,
    input: SetPrinterEnabledInput,
  ): Promise<PrinterModel> {
    const current = await this.mustFind(operator, input.id);
    const printer = await this.transactions.withTransaction(async () => {
      const updated = await this.printers.updateById(operator, current._id, {
        $set: { enabled: input.enabled },
      });
      if (updated === null) {
        throw notFoundError(`printer not found: ${input.id}`);
      }
      await this.audit.record(operator, {
        action: AUDIT.toggleEnabled,
        targetType: AUDIT_TARGET_TYPE,
        targetId: updated._id,
        before: { enabled: current.enabled },
        after: { enabled: input.enabled },
      });
      return updated;
    });
    return this.toModel(operator, printer);
  }

  /** 測試列印前的存在檢查(可見範圍外視同不存在)。 */
  async assertExists(operator: OperatorContext, id: string): Promise<void> {
    await this.mustFind(operator, id);
  }

  // ---- 內部 ----

  private async mustFind(
    operator: OperatorContext,
    id: string,
  ): Promise<PrinterRecord> {
    const printerId = parseObjectId(id);
    const printer =
      printerId === null
        ? null
        : await this.printers.findById(operator, printerId);
    if (printer === null) {
      throw notFoundError(`printer not found: ${id}`);
    }
    return printer;
  }

  private async findAgent(
    operator: OperatorContext,
    id: string,
  ): Promise<AgentRecord | null> {
    const agentId = parseObjectId(id);
    return agentId === null ? null : this.agents.findById(operator, agentId);
  }

  private async clearDefault(
    operator: OperatorContext,
    orgId: Types.ObjectId,
  ): Promise<void> {
    await this.printers.updateMany(
      operator,
      { orgId, isDefault: true },
      { $set: { isDefault: false } },
    );
  }

  private async toModel(
    operator: OperatorContext,
    printer: PrinterRecord,
  ): Promise<PrinterModel> {
    const [model] = await this.toModels(operator, [printer]);
    if (model === undefined) {
      throw fieldError("id", "INVALID", "printer not found");
    }
    return model;
  }

  private async toModels(
    operator: OperatorContext,
    printers: readonly PrinterRecord[],
  ): Promise<PrinterModel[]> {
    const ids = [
      ...new Set(printers.map((printer) => String(printer.agentId))),
    ];
    const agents =
      ids.length === 0
        ? []
        : await this.agents.findMany(operator, {
            _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
          });
    const byId = new Map(agents.map((agent) => [String(agent._id), agent]));
    const now = new Date();
    return printers.map((printer) => toPrinterModel(printer, byId, now));
  }
}
