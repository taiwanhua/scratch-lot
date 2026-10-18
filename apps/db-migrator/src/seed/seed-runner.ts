import { isDeepStrictEqual } from "node:util";

import type {
  Collection,
  Db,
  Document,
  Filter,
  ObjectId,
  WithId,
} from "mongodb";

import { definitionSeedId } from "@repo/domain/seed";

import { ensureRootAdmin, readRootAdminInput } from "./root-admin";
import { planSeedRegistry } from "./seed-composition";
import {
  DEFAULT_INITIAL_SEED_VALUE_FIELDS,
  type DefinitionSeedSet,
  type SeedAdoptBy,
  type SeedDocument,
  type SeedDocumentSet,
  type SeedKeyReference,
  type SeedRegistry,
  type SeedRelation,
  type SeedRelationSet,
  type SeedRootAdminSet,
  type SeedSet,
  isDefinitionSeedSet,
  isSeedIdReference,
} from "./seed-declaration";

/**
 * 摘要的四種計數。`adopted` = 認養:宣告的識別鍵(或 `adoptBy`)對到一筆**人建的**文件
 * (`isSystem` 不是 `true`),把它轉成種子、`_id` 不動(ADR-0002)。認養單向,下次重跑就是更新 / 未變。
 */
export interface SeedCounts {
  created: number;
  updated: number;
  adopted: number;
  unchanged: number;
}

const ZERO_COUNTS: SeedCounts = {
  created: 0,
  updated: 0,
  adopted: 0,
  unchanged: 0,
};

export interface SeedSetResult {
  label: string;
  counts: SeedCounts;
}

type SyncOutcome = keyof SeedCounts;

/**
 * 只挑出與宣告不同的欄位,讓「未變」不產生任何寫入。
 *
 * 初始 seed 值的欄位(ADR-0002)**有值就永不覆寫** — 那是人在系統內管理的值。
 * 唯一的例外是**欄位根本不存在**:新增一個初始值欄位(如 `modules.icon`)時,
 * 已經種過的環境裡的舊文件沒有這一欄,不補就永遠拿不到初值、新功能等於沒上線。
 * 補的是「從未被寫過的欄位」,不是「被改過的值」—— 清成 `null` 也算有值(欄位存在),不會被翻回宣告值。
 */
function pickChangedFields(
  existing: Document,
  desired: Record<string, unknown>,
  initialSeedValueFields: ReadonlySet<string>,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(desired)) {
    if (initialSeedValueFields.has(field)) {
      if (!(field in existing)) {
        changes[field] = value;
      }
      continue;
    }
    if (!isDeepStrictEqual(existing[field], value)) {
      changes[field] = value;
    }
  }
  return changes;
}

async function resolveSeedId(
  database: Db,
  reference: SeedKeyReference,
): Promise<ObjectId> {
  const document = await database
    .collection(reference.collection)
    .findOne({ key: reference.key }, { projection: { _id: 1 } });
  if (!document) {
    throw new Error(
      `找不到種子文件 ${reference.collection}.${reference.key},請確認 registry 順序(被引用者在前)`,
    );
  }
  return document._id;
}

async function resolveValue(database: Db, value: unknown): Promise<unknown> {
  if (isSeedIdReference(value)) {
    return resolveSeedId(database, value.$seedRef);
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveValue(database, item)));
  }
  return value;
}

/** 把 data 中的 seedRef 欄位值換成該環境的 _id(只看頂層欄位;頂層陣列逐元素解析)。 */
async function resolveReferences(
  database: Db,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(data)) {
    resolved[field] = await resolveValue(database, value);
  }
  return resolved;
}

interface DocumentSyncOptions {
  /** 存放 entry.key 的欄位名。 */
  keyField: string;
  /** 找既有文件時的額外條件(`SeedDocumentSet.match`)。 */
  match: Record<string, unknown>;
  /** 建立後永不比對、永不覆寫的欄位。 */
  initialSeedValueFields: ReadonlySet<string>;
  /** 以識別鍵找不到時,找人建的同一筆來認養(`SeedDocumentSet.adoptBy`)。 */
  adoptBy: SeedAdoptBy | undefined;
}

/** 認養的候選:宣告裡指定的欄位值(已解析)+ `where`(seedRef 同樣解析)。 */
async function findAdoptable(
  database: Db,
  collection: Collection,
  adoptBy: SeedAdoptBy,
  desired: Record<string, unknown>,
): Promise<WithId<Document> | null> {
  const filter: Filter<Document> = {
    ...(await resolveReferences(database, adoptBy.where)),
  };
  for (const field of adoptBy.fields) {
    filter[field] = desired[field];
  }
  return collection.findOne(filter);
}

async function syncDocument(
  database: Db,
  collection: Collection,
  options: DocumentSyncOptions,
  entry: SeedDocument,
  now: Date,
): Promise<SyncOutcome> {
  const { keyField, initialSeedValueFields, match, adoptBy } = options;
  // 種子記錄一律掛 isSystem 保護(ADR-0002);宣告不得覆寫識別鍵
  const desired = {
    ...(await resolveReferences(database, entry.data)),
    [keyField]: entry.key,
    isSystem: true,
  };
  const existing =
    (await collection.findOne({ ...match, [keyField]: entry.key })) ??
    (adoptBy === undefined
      ? null
      : await findAdoptable(database, collection, adoptBy, desired));

  if (!existing) {
    await collection.insertOne({ ...desired, createdAt: now, updatedAt: now });
    return "created";
  }

  // 人建的那一筆(isSystem 不是 true)被宣告同 key 認養:改掛種子、宣告欄位以 seed 為準,_id 不動
  const isAdoption = existing.isSystem !== true;
  const changes = pickChangedFields(existing, desired, initialSeedValueFields);
  if (Object.keys(changes).length === 0) {
    return "unchanged";
  }

  await collection.updateOne(
    { _id: existing._id },
    { $set: { ...changes, updatedAt: now } },
  );
  return isAdoption ? "adopted" : "updated";
}

async function runDocumentSet(
  database: Db,
  set: SeedDocumentSet,
  now: Date,
): Promise<SeedSetResult> {
  const collection = database.collection(set.collection);
  const options: DocumentSyncOptions = {
    keyField: set.keyField ?? "key",
    match: set.match ?? {},
    initialSeedValueFields: new Set(
      set.initialSeedValueFields ?? DEFAULT_INITIAL_SEED_VALUE_FIELDS,
    ),
    adoptBy: set.adoptBy,
  };
  const counts: SeedCounts = { ...ZERO_COUNTS };
  for (const entry of set.entries) {
    const outcome = await syncDocument(
      database,
      collection,
      options,
      entry,
      now,
    );
    counts[outcome] += 1;
  }
  return { label: set.collection, counts };
}

async function syncRelation(
  database: Db,
  relation: SeedRelation,
  now: Date,
): Promise<SyncOutcome> {
  const collection = database.collection("core_relationships");
  const link = {
    type: relation.type,
    firstId: await resolveSeedId(database, relation.first),
    secondId: await resolveSeedId(database, relation.second),
    thirdId: null,
  };
  const existing = await collection.findOne(link);
  if (existing) {
    return "unchanged";
  }
  await collection.insertOne({ ...link, createdAt: now, updatedAt: now });
  return "created";
}

async function runRelationSet(
  database: Db,
  set: SeedRelationSet,
  now: Date,
): Promise<SeedSetResult> {
  const counts: SeedCounts = { ...ZERO_COUNTS };
  for (const relation of set.entries) {
    counts[await syncRelation(database, relation, now)] += 1;
  }
  return { label: "core_relationships", counts };
}

async function runRootAdminSet(
  database: Db,
  set: SeedRootAdminSet,
  env: NodeJS.ProcessEnv,
  now: Date,
): Promise<SeedSetResult> {
  const outcome = await ensureRootAdmin(
    database,
    set,
    readRootAdminInput(env),
    now,
  );
  const counts: SeedCounts = { ...ZERO_COUNTS };
  counts[outcome] += 1;
  return { label: "root-admin", counts };
}

/**
 * 版本化定義(表單 / 流程)的處理器:收到依引用排好的定義宣告,回每一份的處理結果。
 * 定義不走本檔的 documents upsert —— 由上層接上 api 的受控 CLI(發布、安裝紀錄、採納與漂移保護都在那邊)。
 */
export type DefinitionSeedHandler = (
  seeds: readonly DefinitionSeedSet[],
) => Promise<SeedSetResult[]>;

export interface SeedContext {
  /** 供 root 初始帳號讀取 ROOT_ADMIN_* 的環境。 */
  env: NodeJS.ProcessEnv;
  /**
   * 定義宣告的處理器。registry 含定義而沒有給處理器時,`runSeeds` 在**任何寫入之前**就失敗:
   * 定義既不會被當成一般文件寫入,也不會被靜默略過。
   */
  definitionHandler?: DefinitionSeedHandler;
}

type PlainSeedSet = Exclude<SeedSet, DefinitionSeedSet>;

function runSet(
  database: Db,
  set: PlainSeedSet,
  context: SeedContext,
  now: Date,
): Promise<SeedSetResult> {
  switch (set.kind) {
    case "documents": {
      return runDocumentSet(database, set, now);
    }
    case "relations": {
      return runRelationSet(database, set, now);
    }
    case "root-admin": {
      return runRootAdminSet(database, set, context.env, now);
    }
  }
}

/** 預檢通過、排好順序的一次執行:普通種子在前,定義宣告另外交給處理器。 */
export interface SeedRunPlan {
  plain: PlainSeedSet[];
  definitions: DefinitionSeedSet[];
}

/**
 * 執行前的預檢(純函式,不碰資料庫):驗整份 registry 並依引用排出順序(`planSeedRegistry`:
 * 撞 key、漏引用、循環、版本化定義的防線),再確認這個入口跑得完 ——
 * 登記了定義卻沒有處理器、要建 root 初始帳號卻缺環境變數,都在這裡就失敗。
 *
 * 任何會寫入或刪除資料的入口(seed、reset)都要在**動資料庫之前**先呼叫:
 * 不通過就整批不做,不會跑到一半才停、也不會先刪了資料才發現種不回去。
 */
export function prepareSeedRun(
  registry: SeedRegistry,
  context: SeedContext,
): SeedRunPlan {
  const plan = planSeedRegistry([{ origin: "registry", seeds: registry }]);
  const definitions = plan.filter((set) => isDefinitionSeedSet(set));
  if (definitions.length > 0 && context.definitionHandler === undefined) {
    throw new Error(
      `registry 登記了 ${String(definitions.length)} 份版本化定義(${definitions
        .map((set) => definitionSeedId(set))
        .join(
          "、",
        )}),但這個入口沒有接上定義的發布處理;定義不會被當成一般文件寫入,也不會被略過,本次沒有寫入或刪除任何資料`,
    );
  }
  const plain = plan.filter((set) => !isDefinitionSeedSet(set));
  if (plain.some((set) => set.kind === "root-admin")) {
    readRootAdminInput(context.env);
  }
  return { plain, definitions };
}

/**
 * 把所有種子冪等同步到資料庫,回傳每組的新增 / 更新 / 認養 / 未變計數。
 *
 * 寫入前先過 `prepareSeedRun`;有問題就整批不做。普通種子先跑(含 root 初始帳號),定義宣告最後交給處理器。
 */
export async function runSeeds(
  database: Db,
  registry: SeedRegistry,
  context: SeedContext,
): Promise<SeedSetResult[]> {
  const { plain, definitions } = prepareSeedRun(registry, context);
  const now = new Date();
  const results: SeedSetResult[] = [];
  for (const set of plain) {
    results.push(await runSet(database, set, context, now));
  }
  if (context.definitionHandler !== undefined && definitions.length > 0) {
    results.push(...(await context.definitionHandler(definitions)));
  }
  return results;
}

export function sumCounts(results: SeedSetResult[]): SeedCounts {
  return results.reduce<SeedCounts>(
    (total, { counts }) => ({
      created: total.created + counts.created,
      updated: total.updated + counts.updated,
      adopted: total.adopted + counts.adopted,
      unchanged: total.unchanged + counts.unchanged,
    }),
    { ...ZERO_COUNTS },
  );
}

export function formatCounts({
  created,
  updated,
  adopted,
  unchanged,
}: SeedCounts): string {
  return `新增 ${String(created)} / 更新 ${String(updated)} / 認養 ${String(adopted)} / 未變 ${String(unchanged)}`;
}
