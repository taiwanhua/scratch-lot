import type { FieldType } from "@repo/domain/form";

import {
  BaseRepository,
  type RepositoryDocument,
} from "../database/base.repository";

/**
 * 專案登記 lookup 來源的契約(Spec B2a;`docs/modules/forms.md`「lookup 登錄表」)。
 *
 * 專案模組以 multi-provider token `LOOKUP_PROVIDER` 提供 `{ declaration, runtime }`(一個或一組):
 *
 * ```ts
 * { provide: LOOKUP_PROVIDER, useFactory: (items) => ({ declaration, runtime: { repository: items } }), inject: [ItemsRepository] }
 * ```
 *
 * `LookupProvidersService` 啟動時收集全部登記並驗證(key 格式、撞名、宣告自洽、repository 是 `BaseRepository`),
 * 不合就丟 `LookupProviderRegistrationError`,app 起不來。執行面只收 repository:搜尋與依值取回由底座以
 * `BaseRepository` 的 `findMany` / `count` 查(租戶隔離、可見範圍、資料範圍、軟刪除由 plugin 自動套),
 * 專案沒有自訂查詢的接縫,放寬不了範圍。
 */
export const LOOKUP_PROVIDER = Symbol("LOOKUP_PROVIDER");

/** 一個來源欄位:型別(帶入時驗型別相容)與讀它需要的權限(沒有就不回這一欄)。 */
export interface LookupFieldSpec {
  type: FieldType;
  /** 讀這一欄要的權限 key(含同層 wildcard);不給 = 看得到這筆就看得到這欄。 */
  permission?: string;
  /** 設計器下拉顯示的欄位名;底座來源用 i18n,專案來源沒給就顯示欄位 key。 */
  label?: string;
}

export interface LookupProviderDeclaration {
  /** 顯示在設計器來源下拉的名稱。 */
  name: string;
  /** 可回的欄位(`id` 一律可回,不必列)。`form_submission` 的欄位依 `formKey` 而定,這裡不列。 */
  fields: Readonly<Record<string, LookupFieldSpec>>;
  /** 可當 `filter` 固定條件的欄位(等值比對);其餘鍵一律不套。 */
  filterFields: readonly string[];
  /** 顯示欄:設計器換到這個來源時預設的 `labelField`(`id` 或 `fields` 之一)。 */
  labelField: string;
  /** 值欄:選項來源換到這個來源時預設的 `valueField`(`id` 或 `fields` 之一);不給 = `id`。 */
  valueField?: string;
}

/** 專案來源的宣告:多了 key(一律 `<專案前綴>_<名稱>`)與讀這個來源本身要的權限。 */
export interface ProjectLookupDeclaration extends LookupProviderDeclaration {
  key: string;
  /** 讀這個來源要的權限(例:該業務模組的 `view`);沒有 → 一律查無。不給 = 不另檢查。 */
  permission?: string;
}

/**
 * 專案來源的執行面:只給 repository,查詢由底座組。欄位名 = 文件欄位名
 * (`fields`、`filterFields`、`keywordFields` 都直接當查詢路徑,值以文件該欄原值回傳)。
 */
export interface ProjectLookupRuntime {
  /**
   * 專案登記的 repository(資料登記導出的 `BaseRepository` 子類實例)。型別只看識別欄位,
   * 是不是 `BaseRepository` 由啟動時的 `instanceof` 檢查把關(不是就起不來)。
   */
  repository: Pick<
    BaseRepository<never, RepositoryDocument>,
    "modelName" | "collectionName"
  >;
  /** 關鍵字比對的欄位(不分大小寫的包含比對);不給 = 只比 `labelField`(`id` 時不比)。 */
  keywordFields?: readonly string[];
}

export interface LookupProviderRegistration {
  declaration: ProjectLookupDeclaration;
  runtime: ProjectLookupRuntime;
}

/** 專案來源登記不合契約(撞名、格式、宣告不自洽);屬程式錯誤,讓 app 起不來。 */
export class LookupProviderRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookupProviderRegistrationError";
  }
}

/** 專案來源 key:`<專案前綴>_<名稱>`,小寫英數與底線(同表單 key 不含 `.` / `-`)。 */
export const PROJECT_LOOKUP_KEY_PATTERN = /^[a-z][a-z0-9]*_[a-z0-9_]*[a-z0-9]$/;

/** 欄位名(也是查詢路徑):不含 `.` / `$`,不能叫 `id`(一律可回)或以 `_` 開頭。 */
const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

function fail(key: string, message: string): never {
  throw new LookupProviderRegistrationError(`lookup 來源 ${key}:${message}`);
}

function checkFieldName(key: string, what: string, name: string): void {
  if (!FIELD_NAME_PATTERN.test(name) || name === "id") {
    fail(key, `${what} ${name} 不是合法的欄位名`);
  }
}

function checkKnownField(
  declaration: ProjectLookupDeclaration,
  what: string,
  name: string,
): void {
  if (name !== "id" && !Object.hasOwn(declaration.fields, name)) {
    fail(declaration.key, `${what} ${name} 不在可回的欄位內`);
  }
}

function checkRegistration(
  registration: LookupProviderRegistration,
  baseKeys: ReadonlySet<string>,
): void {
  const { declaration, runtime } = registration;
  const key = declaration.key;
  if (baseKeys.has(key)) {
    fail(key, "與底座來源撞名");
  }
  if (!PROJECT_LOOKUP_KEY_PATTERN.test(key)) {
    fail(key, "專案來源 key 必須是 `<專案前綴>_<名稱>`(小寫英數與底線)");
  }
  if (declaration.name.trim() === "") {
    fail(key, "name 不可空白");
  }
  for (const name of Object.keys(declaration.fields)) {
    checkFieldName(key, "欄位", name);
  }
  for (const name of declaration.filterFields) {
    checkFieldName(key, "篩選欄位", name);
  }
  for (const name of runtime.keywordFields ?? []) {
    checkFieldName(key, "關鍵字欄位", name);
  }
  checkKnownField(declaration, "顯示欄", declaration.labelField);
  checkKnownField(declaration, "值欄", declaration.valueField ?? "id");
  for (const name of runtime.keywordFields ?? []) {
    checkKnownField(declaration, "關鍵字欄位", name);
  }
  // 執行面一律經 BaseRepository(租戶隔離與範圍由 plugin 套);其他物件一律拒收
  if (!(runtime.repository instanceof BaseRepository)) {
    fail(key, "runtime.repository 必須是 BaseRepository");
  }
}

function isRegistration(value: unknown): value is LookupProviderRegistration {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<LookupProviderRegistration>;
  return (
    typeof candidate.declaration?.key === "string" &&
    typeof candidate.runtime === "object"
  );
}

/**
 * 收集 `LOOKUP_PROVIDER` 的登記(每個 provider 可給一筆或一組),驗證後依 key 回傳。
 * 撞名(專案之間、或拿底座的 key)、格式不合、宣告不自洽 → 丟 `LookupProviderRegistrationError`。
 */
export function collectLookupRegistrations(
  provided: readonly unknown[],
  baseKeys: readonly string[],
): ReadonlyMap<string, LookupProviderRegistration> {
  const base = new Set(baseKeys);
  const collected = new Map<string, LookupProviderRegistration>();
  for (const value of provided) {
    for (const registration of Array.isArray(value) ? value : [value]) {
      if (!isRegistration(registration)) {
        throw new LookupProviderRegistrationError(
          "LOOKUP_PROVIDER 的值必須是 { declaration, runtime } 或其陣列",
        );
      }
      checkRegistration(registration, base);
      if (collected.has(registration.declaration.key)) {
        fail(registration.declaration.key, "重複登記");
      }
      collected.set(registration.declaration.key, registration);
    }
  }
  return collected;
}
