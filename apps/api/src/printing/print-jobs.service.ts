import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Types } from "mongoose";

import {
  PRINT_IMAGE_MAX_BYTES,
  PRINT_IMAGE_WIDTH_DOTS,
  PRINT_JOB_CLAIM_TIMEOUT_MS,
  PRINT_SIGNALS,
  PRINT_TEST_PAGE_DOCUMENT_TYPE,
  PRINT_TEST_PAGE_REF_TYPE,
  type PrintAgentReportableError,
  type PrintJobError,
  type PrintJobResult,
  REPRINT_REASON_CATEGORY_KEY,
  REPRINT_REASON_OTHER,
  isPrintAgentOffline,
} from "@repo/domain/printing";
import { printAgentTopic, userTopic } from "@repo/domain/realtime";

import { authError } from "../auth/auth-error";
import {
  FieldCategoriesRepository,
  FieldsRepository,
  PrintAgentsRepository,
  PrintJobsRepository,
  PrintersRepository,
  UsersRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { TransactionService } from "../database/transaction";
import {
  PermissionResolver,
  holdsPermission,
} from "../permission/permission-resolver";
import { RealtimePublisher } from "../realtime/realtime-publisher.service";
import { ScheduledJobRegistry } from "../scheduled-jobs/scheduled-job-registry";
import {
  type CreatePrintJobInput,
  DEFAULT_PAGE_SIZE,
  type DocumentPrintCountInput,
  MAX_PAGE_SIZE,
  type PrintJobsInput,
  type PrintPrinterTestPageInput,
} from "./dto/printing.input";
import type {
  PrintJobModel,
  PrintJobRequesterModel,
  PrintJobsPayload,
} from "./models/printing.model";
import { internalReader, parseObjectId } from "./print-agent-credentials";
import {
  type PrintingFieldError,
  fieldError,
  notFoundError,
  validationError,
} from "./printing-error";
import {
  type AgentRecord,
  type JobRecord,
  type PrinterRecord,
  pageOf,
  toJobModel,
} from "./printing-mapper";

/** 權限 key(docs/modules/printers.md「權限」)。 */
export const PRINTING_PERMISSIONS = {
  view: "system.printers.view",
  create: "system.printers.create",
  edit: "system.printers.edit",
  print: "api.printing.print",
  reprint: "api.printing.reprint",
} as const;

/** 逾時掃描的排程工作 key(每 15 分鐘補掃一次;平常由讀取時順手判斷)。 */
export const EXPIRE_STALE_JOBS_KEY = "printing.expire-stale-jobs";

/** 一次逾時掃描最多處理幾筆(其餘下一輪)。 */
const EXPIRE_BATCH_LIMIT = 500;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const BASE64 = /^[\d+/A-Za-z]+={0,2}$/;
const DATA_URL_PREFIX = /^data:image\/png;base64,/;
const TEXT_MAX_LENGTH = 200;

/** 建立工作的內部參數(列印按鈕與測試列印共用)。 */
interface NewJob {
  printerId: string;
  documentType: string;
  refType: string;
  refId: string;
  image: string;
  isReprint: boolean;
  reprintReason: string | null;
  reprintNote: string | null;
}

/** 去頭尾空白;空白或過長時把錯誤推進 `errors`。 */
function checkText(
  value: string | null | undefined,
  fieldKey: string,
  errors: PrintingFieldError[],
): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    errors.push({
      fieldKey,
      code: "REQUIRED",
      message: `${fieldKey} is required`,
    });
  } else if (trimmed.length > TEXT_MAX_LENGTH) {
    errors.push({
      fieldKey,
      code: "INVALID",
      message: `${fieldKey} is too long`,
    });
  }
  return trimmed;
}

function invalidImage(message: string) {
  return fieldError("image", "INVALID_IMAGE", message);
}

/** 補印說明:原因是「其他」時必填;過長不行。 */
function checkReprintNote(
  reason: string,
  note: string,
  errors: PrintingFieldError[],
): void {
  if (reason === REPRINT_REASON_OTHER && note === "") {
    errors.push({
      fieldKey: "reprintNote",
      code: "REQUIRED",
      message: "reprintNote is required when the reason is other",
    });
  }
  if (note.length > TEXT_MAX_LENGTH) {
    errors.push({
      fieldKey: "reprintNote",
      code: "INVALID",
      message: "reprintNote is too long",
    });
  }
}

/** 單筆轉換的結果(不會是空的)。 */
function only<T>(models: readonly T[]): T {
  const [first] = models;
  if (first === undefined) {
    throw new Error("expected one model");
  }
  return first;
}

/** base64 PNG → Buffer;驗簽章、IHDR 寬度與大小上限。 */
export function decodePrintImage(raw: string, paperWidth: number): Buffer {
  const text = raw.trim().replace(DATA_URL_PREFIX, "");
  const expectedWidth =
    PRINT_IMAGE_WIDTH_DOTS[paperWidth as keyof typeof PRINT_IMAGE_WIDTH_DOTS];
  if (text === "" || !BASE64.test(text)) {
    throw invalidImage("image must be a base64 PNG");
  }
  const bytes = Buffer.from(text, "base64");
  if (bytes.length > PRINT_IMAGE_MAX_BYTES) {
    throw invalidImage(
      `image is too large (max ${String(PRINT_IMAGE_MAX_BYTES)} bytes)`,
    );
  }
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.toString("latin1", 12, 16) !== "IHDR"
  ) {
    throw invalidImage("image is not a PNG");
  }
  const width = bytes.readUInt32BE(16);
  if (width !== expectedWidth) {
    throw invalidImage(
      `image width must be ${String(expectedWidth)} dots for ${String(paperWidth)}mm paper (got ${String(width)})`,
    );
  }
  return bytes;
}

/**
 * 列印工作(底座規格第 6 章「架構」「離線、逾時、重新配對與停用」;docs/modules/printers.md):
 *
 * - **建立**(列印按鈕 / 測試列印):代理程式已離線 → 仍建立,但直接標失敗 `agent-offline`;
 *   否則等待中,交易提交後送 `print-job` 給 `print-agent:<代理程式>`。
 * - **認領**:條件更新「等待中(且 2 分鐘內)→ 已送出」,信號與輪詢同時到也只有一方成功。
 * - **回報**:已送出 → 已印 / 失敗,送 `print-result` 給 `user:<要求人>`。
 * - **逾時**:等待中超過 2 分鐘 → 失敗 `agent-offline` + `print-result`。讀取時順手判斷
 *   (代理程式拿工作、認領、查單筆 / 清單),排程每 15 分鐘補掃。
 */
@Injectable()
export class PrintJobsService implements OnModuleInit {
  private readonly logger = new Logger(PrintJobsService.name);

  constructor(
    private readonly jobs: PrintJobsRepository,
    private readonly printers: PrintersRepository,
    private readonly agents: PrintAgentsRepository,
    private readonly users: UsersRepository,
    private readonly fields: FieldsRepository,
    private readonly categories: FieldCategoriesRepository,
    private readonly permissions: PermissionResolver,
    private readonly transactions: TransactionService,
    private readonly realtime: RealtimePublisher,
    private readonly scheduledJobs: ScheduledJobRegistry,
  ) {}

  onModuleInit(): void {
    this.scheduledJobs.registerScheduledJob({
      key: EXPIRE_STALE_JOBS_KEY,
      every: "15m",
      handler: async () => {
        await this.expireStale(internalReader(), {}, new Date());
      },
    });
  }

  // ---- 後台(GraphQL)----

  /** 列印按鈕:建立工作(`api.printing.print`;補印另要 `api.printing.reprint`)。 */
  async createFromButton(
    operator: OperatorContext,
    input: CreatePrintJobInput,
  ): Promise<PrintJobModel> {
    const isReprint = input.isReprint === true;
    if (isReprint) {
      await this.assertHolds(operator, PRINTING_PERMISSIONS.reprint);
    }
    const errors: PrintingFieldError[] = [];
    const documentType = checkText(input.documentType, "documentType", errors);
    const refType = checkText(input.refType, "refType", errors);
    const refId = checkText(input.refId, "refId", errors);
    const reprint = isReprint
      ? await this.checkReprint(operator, input, errors)
      : { reprintReason: null, reprintNote: null };
    if (errors.length > 0) {
      throw validationError(errors);
    }
    return this.create(operator, {
      printerId: input.printerId,
      documentType,
      refType,
      refId,
      image: input.image,
      isReprint,
      ...reprint,
    });
  }

  /** 測試列印(`system.printers.edit`):`refType = printer`、`refId` = 印表機 id。 */
  printTestPage(
    operator: OperatorContext,
    input: PrintPrinterTestPageInput,
  ): Promise<PrintJobModel> {
    return this.create(operator, {
      printerId: input.printerId,
      documentType: PRINT_TEST_PAGE_DOCUMENT_TYPE,
      refType: PRINT_TEST_PAGE_REF_TYPE,
      refId: input.printerId,
      image: input.image,
      isReprint: false,
      reprintReason: null,
      reprintNote: null,
    });
  }

  /**
   * 單筆:要求人本人,或持 `system.printers.view`(列印紀錄)才看得到;其餘視同不存在。
   * 還在等待中且已逾時的,先標失敗再回。
   */
  async findOne(operator: OperatorContext, id: string): Promise<PrintJobModel> {
    const jobId = parseObjectId(id);
    let job = jobId === null ? null : await this.jobs.findById(operator, jobId);
    if (
      job === null ||
      (!job.requestedBy.equals(operator.actorId ?? new Types.ObjectId()) &&
        !(await this.holds(operator, PRINTING_PERMISSIONS.view)))
    ) {
      throw notFoundError(`print job not found: ${id}`);
    }
    job = (await this.expireOne(operator, job, new Date())) ?? job;
    return only(await this.toModels(operator, [job]));
  }

  /** 列印紀錄(新到舊);列之前先把範圍內逾時的等待中工作標失敗。 */
  async list(
    operator: OperatorContext,
    input: PrintJobsInput,
  ): Promise<PrintJobsPayload> {
    await this.expireStale(operator, {}, new Date());
    const { page, pageSize, skip } = pageOf(
      input,
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );
    const filter: Record<string, unknown> = {};
    const orgId = parseObjectId(input.orgId);
    if (input.orgId) {
      filter.orgId = orgId ?? new Types.ObjectId();
    }
    const printerId = parseObjectId(input.printerId);
    if (input.printerId) {
      filter.printerId = printerId ?? new Types.ObjectId();
    }
    if (input.status) {
      filter.status = input.status;
    }
    if (input.refType) {
      filter.refType = input.refType;
    }
    if (input.refId) {
      filter.refId = input.refId;
    }
    const totalCount = await this.jobs.count(operator, filter);
    const documents = await this.jobs.findMany(operator, filter, {
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

  /** 一張單據已印的次數(只算「已印」;失敗、等待中不算)。 */
  async printedCount(
    operator: OperatorContext,
    input: DocumentPrintCountInput,
  ): Promise<number> {
    return this.jobs.count(operator, {
      refType: input.refType,
      refId: input.refId,
      status: "printed",
    });
  }

  // ---- 代理程式(HTTP;呼叫端已用金鑰驗過身分,operator = 代理程式分店)----

  /** 未完成的工作:先把逾時的標失敗,再列 2 分鐘內等待中的(啟動時拉到舊工作也不印)。 */
  async pendingForAgent(
    operator: OperatorContext,
    agent: AgentRecord,
    now: Date,
  ): Promise<JobRecord[]> {
    await this.expireStale(operator, { agentId: agent._id }, now);
    return this.jobs.findMany(
      operator,
      {
        agentId: agent._id,
        status: "pending",
        createdAt: {
          $gte: new Date(now.getTime() - PRINT_JOB_CLAIM_TIMEOUT_MS),
        },
      },
      { sort: { createdAt: 1, _id: 1 }, limit: 100 },
    );
  }

  /**
   * 認領:條件更新「這個代理程式的、等待中、2 分鐘內」→ 已送出;沒命中回 null
   * (別人已認領、已逾時、不是自己的、或根本不存在 —— 代理程式一律不印)。
   */
  async claim(
    operator: OperatorContext,
    agent: AgentRecord,
    jobId: Types.ObjectId,
    now: Date,
  ): Promise<JobRecord | null> {
    const claimed = await this.jobs.findOneAndUpdate(
      operator,
      {
        _id: jobId,
        agentId: agent._id,
        status: "pending",
        createdAt: {
          $gte: new Date(now.getTime() - PRINT_JOB_CLAIM_TIMEOUT_MS),
        },
      },
      { $set: { status: "sent", sentAt: now } },
    );
    if (claimed === null) {
      // 逾時的那筆順手標失敗(要求人收到 print-result)
      const job = await this.jobs.findOne(operator, {
        _id: jobId,
        agentId: agent._id,
      });
      if (job !== null) {
        await this.expireOne(operator, job, now);
      }
    }
    return claimed;
  }

  /** 已送出、自己認領的工作的圖片;其餘回 null。 */
  async imageOf(
    operator: OperatorContext,
    agent: AgentRecord,
    jobId: Types.ObjectId,
  ): Promise<Buffer | null> {
    const job = await this.jobs.findOne(
      operator,
      { _id: jobId, agentId: agent._id, status: "sent" },
      { select: "+image" },
    );
    return job === null ? null : Buffer.from(job.image);
  }

  /** 回報結果:已送出 → 已印 / 失敗;送 `print-result` 給要求人。沒命中回 null。 */
  async report(
    operator: OperatorContext,
    agent: AgentRecord,
    jobId: Types.ObjectId,
    result: PrintJobResult,
    error: PrintAgentReportableError | null,
    now: Date,
  ): Promise<JobRecord | null> {
    const updated = await this.jobs.findOneAndUpdate(
      operator,
      { _id: jobId, agentId: agent._id, status: "sent" },
      {
        $set:
          result === "printed"
            ? { status: "printed", printedAt: now, error: null }
            : { status: "failed", error: error ?? "other" },
      },
    );
    if (updated !== null) {
      await this.publishResults([updated]);
    }
    return updated;
  }

  /** 代理程式的印表機(拿工作時一起給設定)。 */
  printersOfAgent(
    operator: OperatorContext,
    agent: AgentRecord,
  ): Promise<PrinterRecord[]> {
    return this.printers.findMany(
      operator,
      { agentId: agent._id },
      { sort: { createdAt: 1, _id: 1 } },
    );
  }

  /** 單台印表機(認領成功後回給代理程式)。 */
  printerOf(
    operator: OperatorContext,
    printerId: Types.ObjectId,
  ): Promise<PrinterRecord | null> {
    return this.printers.findById(operator, printerId);
  }

  // ---- 停用代理程式時(在呼叫端的交易內)----

  /** 把這個代理程式等待中的工作標失敗 `agent-disabled`;交易提交後各送 `print-result`。 */
  async failPendingOfAgent(
    operator: OperatorContext,
    agentId: Types.ObjectId,
  ): Promise<void> {
    const pending = await this.jobs.findMany(operator, {
      agentId,
      status: "pending",
    });
    if (pending.length === 0) {
      return;
    }
    await this.jobs.updateMany(
      operator,
      { _id: { $in: pending.map((job) => job._id) }, status: "pending" },
      { $set: { status: "failed", error: "agent-disabled" } },
    );
    for (const job of pending) {
      this.realtime.publishAfterCommit(
        job.tenantId,
        [userTopic(String(job.requestedBy))],
        { type: PRINT_SIGNALS.result, id: String(job._id) },
      );
    }
  }

  // ---- 逾時 ----

  /**
   * 把範圍內「等待中超過 2 分鐘」的工作標失敗 `agent-offline`,逐筆送 `print-result`。
   * 每筆是獨立的條件更新(與認領競爭時只有一方成功);不在交易內呼叫。
   */
  async expireStale(
    operator: OperatorContext,
    filter: Record<string, unknown>,
    now: Date,
  ): Promise<number> {
    const stale = await this.jobs.findMany(
      operator,
      {
        ...filter,
        status: "pending",
        createdAt: {
          $lt: new Date(now.getTime() - PRINT_JOB_CLAIM_TIMEOUT_MS),
        },
      },
      { limit: EXPIRE_BATCH_LIMIT },
    );
    const expired: JobRecord[] = [];
    for (const job of stale) {
      const failed = await this.markFailed(operator, job, "agent-offline");
      if (failed !== null) {
        expired.push(failed);
      }
    }
    await this.publishResults(expired);
    return expired.length;
  }

  // ---- 內部 ----

  private async create(
    operator: OperatorContext,
    input: NewJob,
  ): Promise<PrintJobModel> {
    if (operator.actorId === null) {
      throw authError("UNAUTHENTICATED", "Printing requires a login");
    }
    const requestedBy = operator.actorId;
    const printerId = parseObjectId(input.printerId);
    const printer =
      printerId === null
        ? null
        : await this.printers.findById(operator, printerId);
    if (printer === null) {
      throw fieldError("printerId", "INVALID", "printer not found");
    }
    const agent = await this.agents.findById(operator, printer.agentId);
    if (!printer.enabled || agent?.enabled !== true) {
      throw fieldError(
        "printerId",
        "PRINTER_UNAVAILABLE",
        "printer or its agent is disabled",
      );
    }
    const image = decodePrintImage(input.image, printer.paperWidth);
    const now = new Date();
    const offline = isPrintAgentOffline(agent.lastSeenAt, now);
    const job = await this.transactions.withTransaction(async () => {
      const printedCount = await this.jobs.count(operator, {
        refType: input.refType,
        refId: input.refId,
        status: "printed",
      });
      const created = await this.jobs.create(operator, {
        orgId: printer.orgId,
        printerId: printer._id,
        agentId: agent._id,
        documentType: input.documentType,
        refType: input.refType,
        refId: input.refId,
        image,
        // 送出時代理程式已離線:仍建立工作,按鈕立即顯示「✗ 失敗:代理程式離線」
        status: offline ? "failed" : "pending",
        error: offline ? "agent-offline" : null,
        isReprint: input.isReprint,
        printNo: printedCount + 1,
        reprintReason: input.isReprint ? input.reprintReason : null,
        reprintNote: input.isReprint ? input.reprintNote : null,
        requestedBy,
      });
      if (!offline) {
        this.realtime.publishAfterCommit(
          created.tenantId,
          [printAgentTopic(String(agent._id))],
          { type: PRINT_SIGNALS.job, id: String(created._id) },
        );
      }
      return created;
    });
    return only(await this.toModels(operator, [job]));
  }

  /** 單筆逾時判斷:等待中且超過 2 分鐘 → 標失敗並送信號,回更新後的文件;否則 null。 */
  private async expireOne(
    operator: OperatorContext,
    job: JobRecord,
    now: Date,
  ): Promise<JobRecord | null> {
    if (
      job.status !== "pending" ||
      now.getTime() - job.createdAt.getTime() <= PRINT_JOB_CLAIM_TIMEOUT_MS
    ) {
      return null;
    }
    const failed = await this.markFailed(operator, job, "agent-offline");
    if (failed !== null) {
      await this.publishResults([failed]);
    }
    return failed;
  }

  private markFailed(
    operator: OperatorContext,
    job: JobRecord,
    error: PrintJobError,
  ): Promise<JobRecord | null> {
    return this.jobs.findOneAndUpdate(
      operator,
      { _id: job._id, status: "pending" },
      { $set: { status: "failed", error } },
    );
  }

  /** 對要求人送 `print-result`(交易外;盡力而為)。 */
  private async publishResults(jobs: readonly JobRecord[]): Promise<void> {
    for (const job of jobs) {
      await this.realtime.publish(
        job.tenantId,
        [userTopic(String(job.requestedBy))],
        { type: PRINT_SIGNALS.result, id: String(job._id) },
      );
    }
  }

  /** 補印的原因(必填、須是選項)與說明(「其他」必填);錯誤推進 `errors`。 */
  private async checkReprint(
    operator: OperatorContext,
    input: CreatePrintJobInput,
    errors: PrintingFieldError[],
  ): Promise<{ reprintReason: string | null; reprintNote: string | null }> {
    const reason = input.reprintReason?.trim() ?? "";
    const note = input.reprintNote?.trim() ?? "";
    if (reason === "") {
      errors.push({
        fieldKey: "reprintReason",
        code: "REQUIRED",
        message: "reprintReason is required for a reprint",
      });
    } else if (await this.isReprintReason(operator, reason)) {
      checkReprintNote(reason, note, errors);
    } else {
      errors.push({
        fieldKey: "reprintReason",
        code: "INVALID",
        message: `unknown reprint reason: ${reason}`,
      });
    }
    return {
      reprintReason: reason === "" ? null : reason,
      reprintNote: note === "" ? null : note,
    };
  }

  /** 補印原因是不是「補印原因」類別裡、操作者看得到的啟用選項。 */
  private async isReprintReason(
    operator: OperatorContext,
    value: string,
  ): Promise<boolean> {
    const category = await this.categories.findOne(operator, {
      key: REPRINT_REASON_CATEGORY_KEY,
    });
    if (category === null) {
      this.logger.warn(
        `欄位類別 ${REPRINT_REASON_CATEGORY_KEY} 不存在(seed 未跑?),補印原因一律不合法`,
      );
      return false;
    }
    const option = await this.fields.findOne(operator, {
      categoryId: category._id,
      value,
      enabled: true,
    });
    return option !== null;
  }

  private async holds(
    operator: OperatorContext,
    key: string,
  ): Promise<boolean> {
    if (operator.actorId === null) {
      return false;
    }
    const resolution = await this.permissions.resolve(
      operator.actorId,
      operator.currentOrgId,
    );
    return holdsPermission(resolution, key);
  }

  private async assertHolds(
    operator: OperatorContext,
    key: string,
  ): Promise<void> {
    if (!(await this.holds(operator, key))) {
      throw authError("FORBIDDEN", `Missing permission ${key}`);
    }
  }

  private async toModels(
    operator: OperatorContext,
    jobs: readonly JobRecord[],
  ): Promise<PrintJobModel[]> {
    const ids = [...new Set(jobs.map((job) => String(job.requestedBy)))];
    const users =
      ids.length === 0
        ? []
        : await this.users.findMany(operator, {
            _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
          });
    const requesters = new Map<string, PrintJobRequesterModel>(
      users.map((user) => [
        String(user._id),
        { id: String(user._id), name: user.name },
      ]),
    );
    return jobs.map((job) => toJobModel(job, requesters));
  }
}
