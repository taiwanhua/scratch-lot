/* eslint-disable @repo/no-raw-model-query -- 審核流程對 form_submissions 的系統讀寫:審核者 / 背景推進不在申請人組織的可見範圍內、也不該被資料範圍規則(含「全部操作者」對象的規則)擋掉,改以 tenantId 為邊界(fail-closed);只給引擎、授權判斷與申請中心用;到期條件:無 */
import type { ClientSession, Model, Types, mongo } from "mongoose";

import type { SessionOptions } from "./base.repository";
import type { BaseFields } from "./plugins/base-fields.plugin";
import type { FormSubmission } from "./schemas/form-submission.schema";
import { assertTenantBoundary } from "./tenant-boundary";
import { currentSession } from "./transaction";

/** 已落庫的一筆提交(原生驅動讀出的形狀;含基礎欄位)。 */
export type SubmissionSnapshotRecord = FormSubmission &
  BaseFields & { _id: Types.ObjectId };

/** 6b 加的欄位:6b 之前建立的文件沒有(原生驅動不補 schema 預設值),讀出時補上。 */
type WorkflowFieldKey =
  | "currentInstanceId"
  | "blocked"
  | "voidedAt"
  | "voidedBy"
  | "voidReason"
  | "replacedById"
  | "copiedFrom";

type StoredSubmission = Omit<SubmissionSnapshotRecord, WorkflowFieldKey> &
  Partial<Pick<SubmissionSnapshotRecord, WorkflowFieldKey>>;

type SubmissionCollection = mongo.Collection<StoredSubmission>;

function withDefaults(stored: StoredSubmission): SubmissionSnapshotRecord {
  return {
    ...stored,
    currentInstanceId: stored.currentInstanceId ?? null,
    blocked: stored.blocked ?? false,
    voidedAt: stored.voidedAt ?? null,
    voidedBy: stored.voidedBy ?? null,
    voidReason: stored.voidReason ?? null,
    replacedById: stored.replacedById ?? null,
    copiedFrom: stored.copiedFrom ?? null,
  };
}

/** 查詢條件(`tenantId` 與軟刪除排除由方法補上)。 */
export type SubmissionFilter = mongo.Filter<StoredSubmission>;

type SubmissionUpdate = mongo.UpdateFilter<StoredSubmission>;

/**
 * **允許注入 / 引用這個 store 的檔案**(相對 `apps/api/src/`;ADR-0005「例外出口」登記的範圍):
 * 審核流程的引擎、讀取授權與申請中心。`workflow-submission-store.test.ts` 掃整個 src 斷言沒有其他檔案
 * 引用它 —— 新增呼叫端要先在 ADR-0005 登記、再加進這裡。
 */
export const WORKFLOW_SUBMISSION_STORE_CALLERS: readonly string[] = [
  "database/base/registrations.ts",
  "workflows/apply-center/apply-center.service.ts",
  "workflows/workflow-engine/instance-writes.ts",
  "workflows/workflow-engine/step-entry.service.ts",
  "workflows/workflow-engine/submission-read-access.service.ts",
  "workflows/workflow-engine/task-actions.service.ts",
  "workflows/workflow-engine/workflow-engine.service.ts",
];

/** 列表的排序 / 分頁。 */
export interface SubmissionPage {
  sort: Record<string, 1 | -1>;
  skip: number;
  limit: number;
}

/**
 * 審核流程要的 `form_submissions` 存取(Spec 6b §3「誰能看那筆提交」、§6 列 2 / 5 / 8 的提交同步)。
 *
 * **為什麼不經 `FormSubmissionsRepository`**:那一層一定套可見範圍與資料範圍規則(ADR-0005 / ADR-0008),
 * 但審核流程的讀寫者不一定看得到那筆提交 —— 上層主管、別部門的審核者、沒有操作者的背景推進;
 * 而資料範圍規則可以對「全部操作者」生效,系統上下文也會被收窄。所以這裡直接用原生 collection,
 * **每個方法第一個參數就是 `tenantId`**(沒給拋錯),並一律排除軟刪除。
 *
 * 原生 collection 不會自動加入進行中的交易(TX-02):每個方法的 `session` 沒給時用目前交易的 session
 * (`currentSession()`,同 `BaseRepository`),明給 `null` = 刻意在交易外。
 *
 * 呼叫端負責「這個人可不可以讀 / 寫這筆」:讀取授權是 `canReadSubmissionRevision`,
 * 寫入只有引擎的條件同步(提交仍指向本實例、修訂號相符、審核中)與作廢。
 */
export class WorkflowSubmissionStore {
  constructor(private readonly model: Model<FormSubmission>) {}

  private get collection(): SubmissionCollection {
    return this.model.collection as unknown as SubmissionCollection;
  }

  async findById(
    tenantId: Types.ObjectId | null | undefined,
    id: Types.ObjectId,
    options: SessionOptions = {},
  ): Promise<SubmissionSnapshotRecord | null> {
    const stored = await this.collection.findOne(
      conditionOf(tenantId, { _id: id }),
      sessionOptionOf(options),
    );
    return stored === null ? null : withDefaults(stored);
  }

  async findMany(
    tenantId: Types.ObjectId | null | undefined,
    filter: SubmissionFilter,
    page?: SubmissionPage,
    options: SessionOptions = {},
  ): Promise<SubmissionSnapshotRecord[]> {
    const stored = await this.collection
      .find(conditionOf(tenantId, filter), {
        ...(page
          ? { sort: page.sort, skip: page.skip, limit: page.limit }
          : {}),
        ...sessionOptionOf(options),
      })
      .toArray();
    return stored.map((one) => withDefaults(one));
  }

  count(
    tenantId: Types.ObjectId | null | undefined,
    filter: SubmissionFilter,
    options: SessionOptions = {},
  ): Promise<number> {
    return this.collection.countDocuments(
      conditionOf(tenantId, filter),
      sessionOptionOf(options),
    );
  }

  /**
   * 條件更新一筆(引擎的提交同步:條件含 `currentInstanceId` / `revision` / `status`);
   * 回是否真的命中。`updatedAt` / `updatedBy` 在這裡補(原生驅動不經 timestamps 中介層)。
   */
  async updateOne(
    tenantId: Types.ObjectId | null | undefined,
    filter: SubmissionFilter,
    set: Record<string, unknown>,
    actorId: Types.ObjectId | null,
    options: SessionOptions = {},
  ): Promise<boolean> {
    const update: SubmissionUpdate = {
      $set: { ...set, updatedAt: new Date(), updatedBy: actorId },
    };
    const result = await this.collection.updateOne(
      conditionOf(tenantId, filter),
      update,
      sessionOptionOf(options),
    );
    return result.matchedCount > 0;
  }
}

/** 沒給 `session` → 目前交易的 session(不在交易內就不帶);`null` → 刻意在交易外。 */
function sessionOptionOf(options: SessionOptions): {
  session?: ClientSession;
} {
  const session =
    options.session === undefined ? currentSession() : options.session;
  return session ? { session } : {};
}

function conditionOf(
  tenantId: Types.ObjectId | null | undefined,
  filter: SubmissionFilter,
): SubmissionFilter {
  return {
    ...filter,
    tenantId: assertTenantBoundary(tenantId, "form_submissions"),
    deletedAt: null,
  };
}
