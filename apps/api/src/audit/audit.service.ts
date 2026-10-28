import { Injectable } from "@nestjs/common";
import type { Types } from "mongoose";

import type { RepositoryCreate } from "../database/base.repository";
import { AuditLogsRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import type { AuditLog } from "../database/schemas/audit-log.schema";
import type { AccountType } from "../database/schemas/refresh-token.schema";

/** 後台操作者恆為 user 帳號體系(customer 走會員線,v1 不寫稽核)。 */
const DEFAULT_ACTOR_TYPE: AccountType = "user";

/** 缺少操作者(無登入主體的流程不該寫稽核);屬程式錯誤,不是使用者錯誤。 */
export class AuditActorMissingError extends Error {
  override name = "AuditActorMissingError";
}

/**
 * 一筆稽核紀錄的內容(誰、何時、動作發生在哪個組織由 OperatorContext 決定,不由呼叫端給)。
 * `action` 命名見各模組文件的「審計」節(如 `org.provision`、`user.grant-role`)。
 */
export interface AuditRecordInput {
  /** 動作名稱:模組簡稱 + 權限 key 的動作段(docs/modules/<key>.md「審計」)。 */
  action: string;
  /** 被操作對象的類型(如 `org`、`user`、`user_role`)。 */
  targetType?: string;
  /** 被操作對象的 id。 */
  targetId?: Types.ObjectId;
  /** 變更前值:只放有變的欄位;不得放個資明文(如身分證字號,只記「已變更」)。 */
  before?: Record<string, unknown>;
  /** 變更後值:同上。 */
  after?: Record<string, unknown>;
  /** 執行者帳號體系;預設 user(後台),會員線接上時由呼叫端指定。 */
  actorType?: AccountType;
}

/**
 * 稽核(ADR-0004):授權相關變更由**執行動作的模組層**呼叫本服務寫入 `audit_logs`,
 * RelationService / BaseRepository 不自己記(例外:`BaseRepository.reassignOrg` 自己寫搬家稽核,見 ADR-0005)。只增不改 —
 * 本服務只有 `record` / `recordMany`(一次多筆)兩個新增出口,資料層的更新 / 刪除也被 AuditLogsRepository 封死。
 *
 * 操作者一律由呼叫端傳入(與 BaseRepository 同一約定:每個公開方法以操作者上下文開頭),
 * actor(`actorId`)與 `orgId`(動作發生的組織脈絡 = 操作者當前組織)都自其取得,呼叫端無法偽造。
 */
@Injectable()
export class AuditService {
  constructor(private readonly auditLogs: AuditLogsRepository) {}

  async record(
    operator: OperatorContext,
    input: AuditRecordInput,
  ): Promise<void> {
    await this.auditLogs.create(operator, auditLogOf(operator, input));
  }

  /**
   * **一次寫多筆稽核**(TX-06):每筆的內容與 `record` 相同(actor / actorType / 組織脈絡都由操作者決定),
   * 底層一次 `createMany`(ordered `insertMany`)。與 `createMany` 同一條規則:**必須在交易內**
   * (不在交易內 → `TenantScopeError`),一筆沒過整批不寫;空清單不送指令。
   * 粒度不變:原本逐筆 `record` 幾筆,這裡就給幾筆,只是合成一次往返。
   * 注意與 `record` 不同:`record` 在交易外也能寫,`recordMany` 不行。
   * `audit_logs` 有自訂 `pre("save")`,但它只擋「非新建」的存檔;`insertMany` 略過它不影響只增不改。
   */
  async recordMany(
    operator: OperatorContext,
    inputs: readonly AuditRecordInput[],
  ): Promise<void> {
    if (inputs.length === 0) {
      return;
    }
    await this.auditLogs.createMany(
      operator,
      inputs.map((input) => auditLogOf(operator, input)),
    );
  }
}

/** 一筆稽核要寫入的內容;缺操作者 → `AuditActorMissingError`(`record` / `recordMany` 共用)。 */
function auditLogOf(
  operator: OperatorContext,
  input: AuditRecordInput,
): RepositoryCreate<AuditLog> {
  const actorId = operator.actorId;
  if (actorId === null) {
    throw new AuditActorMissingError(
      `稽核紀錄需要操作者(action=${input.action});無登入主體的流程不寫稽核`,
    );
  }
  return {
    actorId,
    actorType: input.actorType ?? DEFAULT_ACTOR_TYPE,
    action: input.action,
    ...(input.targetType === undefined ? {} : { targetType: input.targetType }),
    ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
    ...(input.before === undefined ? {} : { before: input.before }),
    ...(input.after === undefined ? {} : { after: input.after }),
  };
}
