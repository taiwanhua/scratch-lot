import type { InjectionToken } from "@nestjs/common";

import type { FieldType } from "@repo/domain/form";

import {
  BaseRepository,
  type RepositoryDocument,
} from "../database/base.repository";

/**
 * 專案登記 lookup 來源的契約(`docs/modules/forms.md`「lookup 登錄表」)。
 *
 * 專案在固定入口 `src/project/lookup-providers.ts` 列 `{ declaration, repositoryToken }`(同
 * `project/database/registrations.ts` 的靜態清單)。清單由 `database/database.module.ts` 組裝:
 * `repositoryToken` 必須是專案資料登記裡的 repository(拿底座的 → app 起不來),再以
 * `PROJECT_LOOKUP_SOURCES` 提供給 `LookupProvidersService`;api 與受管定義 CLI 拿到的是同一份。
 *
 * `LookupProvidersService` 啟動時以 `ModuleRef` 取 repository 實例並驗證(key 格式與前綴、撞名、
 * 宣告自洽、`BaseRepository`),不合就丟 `LookupProviderRegistrationError`。搜尋與依值取回由底座以
 * `BaseRepository` 的 `findMany` / `count` 查(租戶隔離、可見範圍、資料範圍、軟刪除由 plugin 套),
 * 專案沒有自訂查詢的接縫,放寬不了範圍。
 */

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

/**
 * 專案來源的宣告。欄位名 = 文件欄位名(`fields`、`filterFields`、`keywordFields` 都直接當查詢路徑,
 * 值以文件該欄原值回傳)。
 */
export interface ProjectLookupDeclaration extends LookupProviderDeclaration {
  /** `<前綴>_<名稱>`,前綴 = repository 所綁 collection 名的第一段(`demo_item` ↔ `demo_items`)。 */
  key: string;
  /** 讀這個來源要的權限(例:該業務模組的 `view`;沒有 → 一律查無);`null` = 在可見範圍內公開。 */
  permission: string | null;
  /** 關鍵字比對的欄位(不分大小寫的包含比對);不給 = 只比 `labelField`(`id` 時不比)。 */
  keywordFields?: readonly string[];
  /**
   * **依表單欄位換值的共用篩選**(ADR-0014):`filter` 裡這個鍵的值是一個組織 id(通常以連動篩選
   * `{ var: <表單的組織欄位> }` 換值),只列「給那個組織看得到」的資料 —— 歸屬是它、它沿用的上層,
   * 或共用給它(`shareOrgs` / `sharedByFields`)。例:付款帳戶只列共用給這張單「申請分店」的。
   *
   * 鍵必須列在 `filterFields`、不能同時是 `fields` 的欄位;資料表要宣告資料共用(不是 `private`)。
   * 條件仍與操作者自己的讀取範圍 `$and`,放寬不了;值不是合法 id 或讀不到那個組織 → 查無。
   */
  sharedToFilter?: string;
}

/** 固定入口 `project/lookup-providers.ts` 的一筆。 */
export interface LookupProviderRegistration {
  declaration: ProjectLookupDeclaration;
  /** 專案資料登記裡的 repository(`project/database/registrations.ts` 的 `repositories[].provider`)。 */
  repositoryToken: InjectionToken;
}

/** 解析後的專案來源:宣告 + 已驗證的 BaseRepository 實例。 */
export interface ResolvedLookupSource {
  declaration: ProjectLookupDeclaration;
  repository: BaseRepository<unknown, RepositoryDocument>;
}

/** 專案來源登記不合契約(撞名、格式、宣告不自洽);屬程式錯誤,讓 app 起不來。 */
export class LookupProviderRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookupProviderRegistrationError";
  }
}

/** 專案來源 key:`<前綴>_<名稱>`,小寫英數與底線(同表單 key 不含 `.` / `-`)。 */
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

/** 第一段(`demo_item` → `demo`)。 */
function prefixOf(name: string): string {
  return name.split("_", 1)[0] ?? "";
}

function checkDeclaration(
  declaration: ProjectLookupDeclaration,
  baseKeys: ReadonlySet<string>,
): void {
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
  const permission: unknown = declaration.permission;
  if (
    permission !== null &&
    (typeof permission !== "string" || permission.trim() === "")
  ) {
    fail(key, "permission 必須是權限 key 或 null(在可見範圍內公開)");
  }
  for (const name of Object.keys(declaration.fields)) {
    checkFieldName(key, "欄位", name);
  }
  for (const name of declaration.filterFields) {
    checkFieldName(key, "篩選欄位", name);
  }
  for (const name of declaration.keywordFields ?? []) {
    checkFieldName(key, "關鍵字欄位", name);
    checkKnownField(declaration, "關鍵字欄位", name);
  }
  const sharedTo = declaration.sharedToFilter;
  if (sharedTo !== undefined) {
    if (!declaration.filterFields.includes(sharedTo)) {
      fail(key, `共用篩選 ${sharedTo} 必須列在 filterFields`);
    }
    if (Object.hasOwn(declaration.fields, sharedTo)) {
      fail(key, `共用篩選 ${sharedTo} 不能同時是可回的欄位`);
    }
  }
  checkKnownField(declaration, "顯示欄", declaration.labelField);
  const valueField = declaration.valueField ?? "id";
  checkKnownField(declaration, "值欄", valueField);
  // 依值取回以字串比對:非 id 的值欄只能是文字欄位(同檢查器的規則)
  if (valueField !== "id" && declaration.fields[valueField]?.type !== "text") {
    fail(key, `值欄 ${valueField} 必須是 id 或文字欄位`);
  }
}

function checkRepository(
  declaration: ProjectLookupDeclaration,
  repository: unknown,
): BaseRepository<unknown, RepositoryDocument> {
  // 執行面一律經 BaseRepository(租戶隔離與範圍由 plugin 套);其他物件一律拒收
  if (!(repository instanceof BaseRepository)) {
    fail(declaration.key, "repositoryToken 必須指向 BaseRepository");
  }
  const typed = repository as BaseRepository<unknown, RepositoryDocument>;
  if (
    declaration.sharedToFilter !== undefined &&
    (typed.tenantScope?.sharing.mode ?? "private") === "private"
  ) {
    fail(
      declaration.key,
      `資料表 ${typed.collectionName} 沒有宣告資料共用,不能設共用篩選`,
    );
  }
  const tablePrefix = prefixOf(typed.collectionName);
  if (prefixOf(declaration.key) !== tablePrefix) {
    fail(
      declaration.key,
      `key 的前綴必須與資料表 ${typed.collectionName} 的第一段相同(${tablePrefix}_…)`,
    );
  }
  return typed;
}

/**
 * 驗證固定入口的專案來源並依 key 回傳(`resolve` 以 token 取 repository 實例,正式為 `ModuleRef.get`)。
 * 撞名(專案之間、或拿底座的 key)、格式或前綴不合、宣告不自洽 → 丟 `LookupProviderRegistrationError`。
 */
export function resolveLookupRegistrations(
  registrations: readonly LookupProviderRegistration[],
  baseKeys: readonly string[],
  resolve: (token: InjectionToken) => unknown,
): ReadonlyMap<string, ResolvedLookupSource> {
  const base = new Set(baseKeys);
  const resolved = new Map<string, ResolvedLookupSource>();
  for (const { declaration, repositoryToken } of registrations) {
    checkDeclaration(declaration, base);
    if (resolved.has(declaration.key)) {
      fail(declaration.key, "重複登記");
    }
    resolved.set(declaration.key, {
      declaration,
      repository: checkRepository(declaration, resolve(repositoryToken)),
    });
  }
  return resolved;
}
