import type { Types } from "mongoose";

import type {
  BaseRepository,
  Persisted,
  RepositoryDocument,
} from "../database/base.repository";
import type { OperatorContext } from "../database/operator-context";
import { isDuplicateKeyError } from "../forms/forms-error";

/**
 * 版本生命週期(Spec 6a §6「發布」;6b 的流程版本複用同一份,少了欄位級權限那一步):
 * 表單版本(`form_versions`)與流程版本(`workflow_versions`)共用的四步發布骨架與退役。
 * 這裡的函式不自己開交易:呼叫端(`FormPublishService`、`WorkflowPublishService`、兩邊的退役)把整個動作
 * 包在一個交易裡(ADR-0013),任一步失敗全部回復,所以交易外永遠看不到 `publishing` 或切換到一半的版本:
 *
 * 1. 檢查器(呼叫端各自跑,有錯就停)
 * 2. `lockDraft`:條件更新 `{ status: "draft", draftRevision: 預期 } → publishing`,同時配正式版號(最大 + 1)、
 *    記 changelog;沒更新到 → `DRAFT_REVISION_MISMATCH`(兩個發布同時來只有一個搶得到)
 * 3. (表單才有)欄位級權限
 * 4. `switchToPublished`:這一版 `publishing → published` → 其餘 `published → retired` →
 *    擁有者的 `currentVersion` 指向新版(填寫 / 送出只看 `currentVersion`,最後一筆寫完前看到的仍是舊版)
 *
 * `publishing` 只是交易內的搶鎖狀態(兩個發布同時搶同一份草稿,只有一個命中)。
 */

/**
 * 步驟 4 每一筆寫入前的檢查點,與退役第 2 步(`currentVersion → null`)前的檢查點
 * (測試在這裡注入失敗;正式環境只記下來)。
 */
export type VersionSwitchCheckpoint =
  "publish-version" | "retire-previous" | "current-version" | "retire-current";

/** 生命週期會回的 `CONFLICT` 原因(表單與流程共用同一組語彙)。 */
export type VersionConflictReason =
  "DRAFT_REVISION_MISMATCH" | "CURRENT_VERSION_CHANGED" | "NO_CURRENT_VERSION";

/**
 * 發布的內部前提(只給受管定義的安裝,`seed/`;GraphQL input 不收):
 * - `draftId`:只發布那一份草稿;它已被刪掉、現在的草稿是別人另開的 → `DRAFT_MISSING`
 * - `expected`:還是登記時的那一筆擁有者、`currentVersion` 也沒變才發布;期間另外發布 / 退役過 →
 *   `CURRENT_VERSION_CHANGED`。在配版號與任何寫入之前判斷;之後切換 `currentVersion` 的條件更新照舊。
 */
export interface PublishInternalOptions {
  draftId?: Types.ObjectId;
  expected?: { ownerId: Types.ObjectId; currentVersion: number | null };
}

/** `expected` 不符時的訊息;符合(或沒給)回 null。擁有者 = 表單 / 流程。 */
export function publishExpectationMismatch(
  owner: LifecycleOwner & { _id: Types.ObjectId },
  expected: PublishInternalOptions["expected"],
): string | null {
  if (expected === undefined) {
    return null;
  }
  if (!owner._id.equals(expected.ownerId)) {
    return `${owner.key} is not the expected definition`;
  }
  return owner.currentVersion === expected.currentVersion
    ? null
    : `${owner.key} current version is ${String(owner.currentVersion)}, expected ${String(expected.currentVersion)}`;
}

/** 版本文件要有的欄位。 */
export interface LifecycleVersion {
  _id: Types.ObjectId;
  version: number | null;
  status: string;
}

/** 擁有者(表單 / 流程)要有的欄位。 */
export interface LifecycleOwner {
  key: string;
  currentVersion: number | null;
}

/** 版本表的最小存取(條件查詢與條件更新)。 */
export interface LifecycleVersionStore<TVersion extends LifecycleVersion> {
  findMany(
    filter: Record<string, unknown>,
    options?: { sort?: Record<string, 1 | -1>; limit?: number },
  ): Promise<TVersion[]>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
  ): Promise<TVersion | null>;
}

export interface VersionLifecycleConfig<TVersion extends LifecycleVersion> {
  /** 版本表指回擁有者的欄位名(`formKey` / `workflowKey`)。 */
  keyField: string;
  versions: LifecycleVersionStore<TVersion>;
  /** 條件切換擁有者的 `currentVersion`(還是 `expected` 才寫成 `next`);沒命中回 false。 */
  switchCurrent: (
    owner: LifecycleOwner,
    expected: number | null,
    next: number | null,
  ) => Promise<boolean>;
  /** 該模組的 `CONFLICT` 錯誤(reason 是上面那一組)。 */
  conflict: (reason: VersionConflictReason, message: string) => Error;
  /** 步驟 4 的檢查點(測試注入失敗用)。 */
  reached: (checkpoint: VersionSwitchCheckpoint) => Promise<void>;
}

/** BaseRepository 型的版本表 → 生命週期要的最小存取(操作者固定在這次請求)。 */
export function repositoryVersionStore<
  TSchema,
  TDocument extends RepositoryDocument & LifecycleVersion,
>(
  repository: BaseRepository<TSchema, TDocument>,
  operator: OperatorContext,
): LifecycleVersionStore<Persisted<TDocument>> {
  return {
    findMany: (filter, options = {}) =>
      repository.findMany(operator, filter, options),
    findOneAndUpdate: (filter, update) =>
      repository.findOneAndUpdate(operator, filter, update),
  };
}

/**
 * 步驟 2:搶鎖並配版號(草稿還是讀到的那一份才改;兩個發布同時來只有一個命中)。
 * 同版號被另一個發布配走(唯一索引)視同沒搶到:轉成 `CONFLICT` **往外拋**,不接著寫
 * (在交易內時整個交易隨之回復,TX-04)。
 */
export async function lockDraftForPublish<TVersion extends LifecycleVersion>(
  config: VersionLifecycleConfig<TVersion>,
  owner: LifecycleOwner,
  draftId: Types.ObjectId,
  expectedDraftRevision: number,
  changelog: string,
): Promise<TVersion> {
  const [latest] = await config.versions.findMany(
    { [config.keyField]: owner.key, version: { $ne: null } },
    { sort: { version: -1 }, limit: 1 },
  );
  const nextVersion = (latest?.version ?? 0) + 1;
  let locked: TVersion | null;
  try {
    locked = await config.versions.findOneAndUpdate(
      { _id: draftId, status: "draft", draftRevision: expectedDraftRevision },
      { $set: { status: "publishing", version: nextVersion, changelog } },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    locked = null;
  }
  if (!locked) {
    throw config.conflict(
      "DRAFT_REVISION_MISMATCH",
      `${owner.key} draft was changed or is being published`,
    );
  }
  return locked;
}

/** 步驟 4:三筆切換(在呼叫端的交易內;`target` 是步驟 2 搶到鎖的那一版)。 */
export async function switchToPublished<TVersion extends LifecycleVersion>(
  config: VersionLifecycleConfig<TVersion>,
  owner: LifecycleOwner,
  target: TVersion,
  actorId: Types.ObjectId | null,
): Promise<TVersion> {
  const version = target.version;
  if (version === null) {
    throw new Error(`發布中的版本沒有版號(${owner.key})`);
  }
  // 4a:這一版 publishing → published
  let published = target;
  if (target.status === "publishing") {
    await config.reached("publish-version");
    published =
      (await config.versions.findOneAndUpdate(
        { _id: target._id, status: "publishing" },
        {
          $set: {
            status: "published",
            publishedAt: new Date(),
            publishedBy: actorId,
          },
        },
      )) ?? target;
  }
  // 4b:前一個(或殘留的)published → retired
  const previous = await config.versions.findMany({
    [config.keyField]: owner.key,
    status: "published",
    _id: { $ne: target._id },
  });
  for (const record of previous) {
    await config.reached("retire-previous");
    await config.versions.findOneAndUpdate(
      { _id: record._id, status: "published" },
      { $set: { status: "retired" } },
    );
  }
  // 4c:currentVersion 指向新版(最後一筆;條件更新,避免蓋掉同時進行的退役 / 發布)
  if (owner.currentVersion !== version) {
    await config.reached("current-version");
    const switched = await config.switchCurrent(
      owner,
      owner.currentVersion,
      version,
    );
    if (!switched) {
      throw config.conflict(
        "CURRENT_VERSION_CHANGED",
        `${owner.key} current version changed while publishing`,
      );
    }
  }
  return published;
}

/**
 * 退役目前版本(Spec 6a §6):呼叫端帶**當時看到的版本號** `expectedVersion`,固定順序兩步條件更新:
 *
 * 1. `{ version: expected, status: "published" } → retired`
 * 2. 擁有者 `{ currentVersion: expected } → null`
 *
 * 兩步在呼叫端的同一個交易裡,任一步失敗一起回復。**冪等**:同一版再退役一次(版本已是 `retired`、
 * `currentVersion` 已是 null)視為完成、什麼都不改;只有 `currentVersion` 已指向別的版本(期間有人發布了新版)才
 * `CURRENT_VERSION_CHANGED`。`expectedVersion` 為 null(呼叫端讀到的就沒有已發布版本)或那一版既不是
 * 已發布也不是已退役 → `NO_CURRENT_VERSION`。回這次被退役的那一版(第 1 步先前已做完則為 null)。
 */
export async function retireCurrentVersion<TVersion extends LifecycleVersion>(
  config: VersionLifecycleConfig<TVersion>,
  owner: LifecycleOwner,
  expectedVersion: number | null,
): Promise<TVersion | null> {
  if (expectedVersion === null) {
    throw config.conflict(
      "NO_CURRENT_VERSION",
      `${owner.key} has no current version`,
    );
  }
  if (
    owner.currentVersion !== null &&
    owner.currentVersion !== expectedVersion
  ) {
    throw config.conflict(
      "CURRENT_VERSION_CHANGED",
      `${owner.key} current version is ${String(owner.currentVersion)}, expected ${String(expectedVersion)}`,
    );
  }
  // 第 1 步:這一版 published → retired;沒命中時確認它已是 retired(上次做到一半)才算完成
  const retired = await config.versions.findOneAndUpdate(
    {
      [config.keyField]: owner.key,
      version: expectedVersion,
      status: "published",
    },
    { $set: { status: "retired" } },
  );
  if (!retired) {
    const [record] = await config.versions.findMany(
      { [config.keyField]: owner.key, version: expectedVersion },
      { limit: 1 },
    );
    if (record?.status !== "retired") {
      throw config.conflict(
        "NO_CURRENT_VERSION",
        `${owner.key} version ${String(expectedVersion)} is not published`,
      );
    }
  }
  // 第 2 步:currentVersion expected → null(已是 null = 上次已做完)
  if (owner.currentVersion === expectedVersion) {
    await config.reached("retire-current");
    const switched = await config.switchCurrent(owner, expectedVersion, null);
    if (!switched) {
      throw config.conflict(
        "CURRENT_VERSION_CHANGED",
        `${owner.key} current version changed while retiring`,
      );
    }
  }
  return retired;
}
