import type { Schema, Types } from "mongoose";

/**
 * 清空一個租戶時「每張 collection 怎麼刪」的登記(`docs/deployment.md`「示範機構清空 / 重建」)。
 *
 * 清空(demo `--mode=purge` / `rebuild`)要刪掉這個租戶的**所有**資料,包括只能新增的帳本
 * (`audit_logs`、各種流水),所以不經 BaseRepository、直接以原生 collection 硬刪;
 * 為了不讓新表漏刪,每一張登記在資料層的 collection 都要在這裡宣告一種刪法 ——
 * 底座的放 `database/base/tenant-purge.ts`,專案的放 `project/database/tenant-purge.ts`,
 * 由 `database.module.ts` 組裝。少登記一張、帶 `tenantId` 卻不是依 `tenantId` 刪,
 * `resolveTenantPurgePlan` 就拋錯(完整性測試 `tenant-purge.test.ts` 擋在合併前)。
 */

/** 一個「這筆屬於被清空的租戶」的條件:欄位值落在某一組 id 裡。 */
export type TenantPurgeCondition =
  /** 欄位值是這個租戶的組織(租戶頂層與它所有下層)。 */
  | { readonly field: string; readonly in: "tenantOrgs" }
  /** 欄位值是會被刪掉的使用者(只屬於這個租戶的人)。 */
  | { readonly field: string; readonly in: "purgedUsers" }
  /** 欄位值是另一張 collection 這次被刪掉的文件的某個欄位(預設 `_id`;例:表單版本跟著表單的 `key`)。 */
  | {
      readonly field: string;
      readonly in: "deleted";
      readonly of: string;
      readonly key?: string;
    };

export type TenantPurgeRule =
  /** 依 `tenantId` 刪(帶 `tenantId` 欄的表一律用這種)。 */
  | { readonly by: "tenantId" }
  /** 任一條件成立就刪。 */
  | { readonly by: "match"; readonly anyOf: readonly TenantPurgeCondition[] }
  /**
   * 由清空服務自己處理(只有底座的組織、使用者、角色、核心關聯:
   * 要先算出「這個租戶有哪些組織 / 只屬於它的人 / 它擁有的角色」才知道刪什麼)。
   */
  | { readonly by: "dedicated"; readonly reason: string }
  /** 不是租戶資料(全平台共用的定義、排程紀錄等),不刪;要寫理由。 */
  | { readonly by: "keep"; readonly reason: string };

export interface TenantPurgeRegistration {
  readonly collection: string;
  readonly rule: TenantPurgeRule;
}

/** 資料層登記的一張 model(取自 `composeDatabaseRegistrations` 的結果)。 */
export interface TenantPurgeModel {
  readonly name: string;
  readonly collection: string;
  readonly schema: Schema;
}

/** 組裝入口交給清空服務的原料:資料層的全部 model 與底座 + 專案的刪法登記。 */
export interface TenantPurgeSources {
  readonly models: readonly TenantPurgeModel[];
  readonly registrations: readonly TenantPurgeRegistration[];
}

/** 清空服務的注入 token(`database.module.ts` 提供)。 */
export const TENANT_PURGE_SOURCES = Symbol("TENANT_PURGE_SOURCES");

/** 由清空服務自己處理的 collection(`dedicated` 只能用在這幾張)。 */
export const DEDICATED_PURGE_COLLECTIONS = [
  "orgs",
  "users",
  "roles",
  "core_relationships",
] as const;

/** 登記不完整或不合法;訊息逐項列出,app 端不會刪任何東西。 */
export class TenantPurgeRegistrationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`清空租戶的刪除登記不完整:\n- ${problems.join("\n- ")}`);
    this.name = "TenantPurgeRegistrationError";
  }
}

/** 依登記刪除的一步(`dedicated` / `keep` 不在步驟裡);依賴的表排在前面。 */
export type TenantPurgeStep =
  | { readonly collection: string; readonly by: "tenantId" }
  | {
      readonly collection: string;
      readonly by: "match";
      readonly anyOf: readonly TenantPurgeCondition[];
    };

export interface TenantPurgePlan {
  readonly steps: readonly TenantPurgeStep[];
  /** 不刪的 collection(對照用)。 */
  readonly kept: readonly string[];
}

function hasPath(schema: Schema, field: string): boolean {
  return field === "_id" || schema.path(field) !== undefined;
}

function checkConditions(
  registration: TenantPurgeRegistration & {
    rule: { by: "match"; anyOf: readonly TenantPurgeCondition[] };
  },
  model: TenantPurgeModel,
  byCollection: ReadonlyMap<string, TenantPurgeRegistration>,
  modelOf: ReadonlyMap<string, TenantPurgeModel>,
): string[] {
  const { collection, rule } = registration;
  const problems: string[] = [];
  if (rule.anyOf.length === 0) {
    problems.push(`${collection}:match 至少要一個條件`);
  }
  for (const condition of rule.anyOf) {
    if (!hasPath(model.schema, condition.field)) {
      problems.push(`${collection}:schema 沒有欄位 ${condition.field}`);
    }
    if (condition.in !== "deleted") {
      continue;
    }
    const parent = byCollection.get(condition.of);
    const parentModel = modelOf.get(condition.of);
    if (parent === undefined || parentModel === undefined) {
      problems.push(`${collection}:依賴的 ${condition.of} 沒有登記`);
      continue;
    }
    if (parent.rule.by === "keep" || parent.rule.by === "dedicated") {
      problems.push(
        `${collection}:依賴的 ${condition.of} 是 ${parent.rule.by},沒有「這次被刪掉的文件」可對`,
      );
    }
    if (!hasPath(parentModel.schema, condition.key ?? "_id")) {
      problems.push(
        `${collection}:${condition.of} 沒有欄位 ${condition.key ?? "_id"}`,
      );
    }
  }
  return problems;
}

/** 依 `deleted` 依賴排序(被依賴的先刪 —— 要先讀到它這次刪掉了哪些);有循環就列為問題。 */
function orderSteps(
  steps: readonly TenantPurgeStep[],
  problems: string[],
): TenantPurgeStep[] {
  const byCollection = new Map(steps.map((step) => [step.collection, step]));
  const ordered: TenantPurgeStep[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (step: TenantPurgeStep): void => {
    const mark = state.get(step.collection);
    if (mark === "done") {
      return;
    }
    if (mark === "visiting") {
      problems.push(`${step.collection}:deleted 依賴形成循環`);
      return;
    }
    state.set(step.collection, "visiting");
    if (step.by === "match") {
      for (const condition of step.anyOf) {
        const parent =
          condition.in === "deleted" ? byCollection.get(condition.of) : null;
        if (parent) {
          visit(parent);
        }
      }
    }
    state.set(step.collection, "done");
    ordered.push(step);
  };
  for (const step of steps) {
    visit(step);
  }
  return ordered;
}

/**
 * 驗證登記並排出刪除步驟。規則:
 * - 資料層登記的每一張 collection 都要有、而且只有一筆刪法;登記了資料層沒有的 collection 也算錯
 * - schema 帶 `tenantId` 欄的表只能 `by: "tenantId"`(不讓帶租戶 id 的表用別的條件漏刪)
 * - `match` 的欄位要存在;`deleted` 依賴的表要登記成會刪的(`tenantId` / `match`),且不能循環
 * - `dedicated` 只能用在 `DEDICATED_PURGE_COLLECTIONS`;`keep` / `dedicated` 都要寫理由
 *
 * 任何一項不合 → `TenantPurgeRegistrationError`(一次列出全部問題)。
 */
export function resolveTenantPurgePlan({
  models,
  registrations,
}: TenantPurgeSources): TenantPurgePlan {
  const problems: string[] = [];
  const modelOf = new Map(models.map((model) => [model.collection, model]));
  const byCollection = new Map<string, TenantPurgeRegistration>();
  for (const registration of registrations) {
    if (byCollection.has(registration.collection)) {
      problems.push(`${registration.collection}:重複登記`);
    }
    byCollection.set(registration.collection, registration);
  }

  for (const model of models) {
    if (!byCollection.has(model.collection)) {
      problems.push(
        `${model.collection}:沒有登記刪法(底座加在 database/base/tenant-purge.ts,專案加在 project/database/tenant-purge.ts)`,
      );
    }
  }

  const steps: TenantPurgeStep[] = [];
  const kept: string[] = [];
  for (const registration of byCollection.values()) {
    const { collection, rule } = registration;
    const model = modelOf.get(collection);
    if (model === undefined) {
      problems.push(`${collection}:資料層沒有這張 collection`);
      continue;
    }
    const hasTenantId = hasPath(model.schema, "tenantId");
    if (hasTenantId && rule.by !== "tenantId") {
      problems.push(`${collection}:帶 tenantId 欄,刪法必須是 by: "tenantId"`);
      continue;
    }
    switch (rule.by) {
      case "tenantId": {
        if (!hasTenantId) {
          problems.push(`${collection}:schema 沒有 tenantId 欄`);
          break;
        }
        steps.push({ collection, by: "tenantId" });
        break;
      }
      case "match": {
        problems.push(
          ...checkConditions(
            { collection, rule },
            model,
            byCollection,
            modelOf,
          ),
        );
        steps.push({ collection, by: "match", anyOf: rule.anyOf });
        break;
      }
      case "dedicated": {
        if (
          !(DEDICATED_PURGE_COLLECTIONS as readonly string[]).includes(
            collection,
          )
        ) {
          problems.push(
            `${collection}:dedicated 只給 ${DEDICATED_PURGE_COLLECTIONS.join(" / ")}`,
          );
        }
        if (rule.reason.trim() === "") {
          problems.push(`${collection}:dedicated 要寫理由`);
        }
        break;
      }
      case "keep": {
        if (rule.reason.trim() === "") {
          problems.push(`${collection}:keep 要寫理由`);
        }
        kept.push(collection);
        break;
      }
    }
  }
  for (const collection of DEDICATED_PURGE_COLLECTIONS) {
    if (
      modelOf.has(collection) &&
      byCollection.get(collection)?.rule.by !== "dedicated"
    ) {
      problems.push(`${collection}:必須登記成 dedicated(由清空服務處理)`);
    }
  }

  const ordered = orderSteps(steps, problems);
  if (problems.length > 0) {
    throw new TenantPurgeRegistrationError(problems);
  }
  return { steps: ordered, kept };
}

/** 清空範圍:這個租戶的組織、會被刪掉的使用者,與已刪表的對照值(`deleted` 條件用)。 */
export interface TenantPurgeScope {
  readonly tenantId: Types.ObjectId;
  readonly tenantOrgIds: readonly Types.ObjectId[];
  readonly purgedUserIds: readonly Types.ObjectId[];
  /** collection → 欄位 → 這次刪掉的文件的那個欄位值。 */
  readonly deletedValues: ReadonlyMap<string, ReadonlyMap<string, unknown[]>>;
}

/** 一步要刪的條件(原生 driver 的 filter)。條件都對不到任何值時回 null(這一步不用刪)。 */
export function filterOfStep(
  step: TenantPurgeStep,
  scope: TenantPurgeScope,
): Record<string, unknown> | null {
  if (step.by === "tenantId") {
    return { tenantId: scope.tenantId };
  }
  const branches = step.anyOf.flatMap((condition) => {
    let values: readonly unknown[];
    switch (condition.in) {
      case "tenantOrgs": {
        values = scope.tenantOrgIds;
        break;
      }
      case "purgedUsers": {
        values = scope.purgedUserIds;
        break;
      }
      case "deleted": {
        values =
          scope.deletedValues.get(condition.of)?.get(condition.key ?? "_id") ??
          [];
        break;
      }
    }
    return values.length === 0
      ? []
      : [{ [condition.field]: { $in: [...values] } }];
  });
  if (branches.length === 0) {
    return null;
  }
  return branches.length === 1 ? (branches[0] ?? null) : { $or: branches };
}

/** 後面的步驟要用到「這張表這次刪掉了哪些值」的欄位(collection → 欄位清單)。 */
export function dependentKeysOf(
  plan: TenantPurgePlan,
): ReadonlyMap<string, readonly string[]> {
  const keys = new Map<string, Set<string>>();
  for (const step of plan.steps) {
    if (step.by !== "match") {
      continue;
    }
    for (const condition of step.anyOf) {
      if (condition.in === "deleted") {
        const set = keys.get(condition.of) ?? new Set<string>();
        set.add(condition.key ?? "_id");
        keys.set(condition.of, set);
      }
    }
  }
  return new Map([...keys].map(([collection, set]) => [collection, [...set]]));
}
