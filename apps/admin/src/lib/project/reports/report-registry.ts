import type { QueryKey } from "@tanstack/react-query";

import type { GraphQLClient } from "@repo/graphql";

import type { SheetData } from "./excel";
import { REPORT_PERIOD_KINDS, type ReportPeriodKind } from "./report-period";

/**
 * 報表登記介面(專案規格 18.4 B11;正本 `docs/modules/project/reports.md`「報表登記介面」)。
 * 「輸出報表」頁只認得這份形狀:選報表 → 條件(期間、分店、其他條件)→ [預覽] [匯出 Excel];
 * 每張報表自己提供查詢與「查詢結果 → 工作表」,Excel 與預覽共用同一份工作表。
 *
 * 登記方式:在 `pages/project/lottery/reports/report-registrations.ts` 的清單加一筆
 * `registerReport({...})`(宣告式清單,載入時不寫共享狀態);權限是模組的頁內權限
 * `reports.<報表 key>`,要在 `seeds/project/reports.ts` 有同名的一筆。
 */

/** 報表模組 key(seed 正本 `apps/db-migrator/seeds/project/reports.ts`;admin 不 import db-migrator)。 */
export const REPORTS_MODULE_KEY = "reports";

/** 模組層的頁內權限(不含每張報表自己那一條)。 */
export const REPORTS_PERMISSIONS = {
  export: `${REPORTS_MODULE_KEY}.export`,
  showCost: `${REPORTS_MODULE_KEY}.show-cost`,
} as const;

/** 一張報表的權限:`reports.<報表 key>`;沒有的報表不出現在選單。 */
export const reportPermissionOf = (reportKey: string): string =>
  `${REPORTS_MODULE_KEY}.${reportKey}`;

/** 其他條件的值:勾選 = 布林、下拉 = 選項值。 */
export type ReportExtraValue = boolean | string;

interface ReportExtraConditionBase {
  /** 條件 key:同時是查詢 input 的欄位名(不可用 `periodKind` / `from` / `to` / `orgIds`) */
  key: string;
  /** 顯示文字的訊息 key(`admin` namespace 底下,例 `lotteryReports.extra.alignDailyClose`;I18N-01) */
  label: string;
  /** 只在某種期間類型出現(例:「對齊日結」只有日);其他類型不顯示、不送 */
  only?: ReportPeriodKind;
}

/** 勾選(預設不勾)。 */
export interface ReportBooleanCondition extends ReportExtraConditionBase {
  type: "boolean";
}

/** 下拉(預設第一個選項)。 */
export interface ReportSelectCondition extends ReportExtraConditionBase {
  type: "select";
  /** 選項;`label` 同樣是訊息 key */
  options: readonly { value: string; label: string }[];
}

export type ReportExtraCondition =
  ReportBooleanCondition | ReportSelectCondition;

export interface ReportConditions {
  /** 這張報表可選的期間類型(頁籤的順序照這裡) */
  period: readonly ReportPeriodKind[];
  /** 分店多選的上限 */
  orgs: { max: number };
  /** 其他條件(下拉、勾選);沒有就給空陣列 */
  extra: readonly ReportExtraCondition[];
}

/**
 * 交給報表查詢的 input:期間的起訖時點(迄不含)、分店,再把其他條件依 key 攤平放進來
 * (例 `{ periodKind: "day", from, to, orgIds, alignDailyClose: true }`)。
 * api 端先呼叫 `assertReportRange`(`apps/api/src/project/reports/report-range.ts`)。
 */
export interface ReportQueryInput {
  periodKind: ReportPeriodKind;
  from: string;
  to: string;
  orgIds: string[];
  [extraKey: string]: ReportExtraValue | string[];
}

export interface ReportQueryVariables {
  input: ReportQueryInput;
}

/**
 * 報表的查詢:直接給 codegen 產的 query hook(例 `useOperationsReportQuery`),
 * 頁面用它的 `getKey` 與 `fetcher`(DATA-01 / DATA-02)。寫成方法簽章,讓各報表自己的 Variables 型別接得上。
 */
export interface ReportQuery<TData> {
  getKey(variables: ReportQueryVariables): QueryKey;
  fetcher(
    client: GraphQLClient,
    variables: ReportQueryVariables,
  ): () => Promise<TData>;
}

/** 選到的分店(工作表名稱用)。 */
export interface ReportOrg {
  id: string;
  name: string;
}

/** 工作表建構時拿得到的東西。 */
export interface ReportSheetContext {
  /** `admin` namespace 的翻譯(表頭、列名、說明都走它) */
  t: (key: string, values?: Record<string, string | number>) => string;
  timezone: string;
  input: ReportQueryInput;
  /** 選的分店,順序照分店選擇器 */
  orgs: readonly ReportOrg[];
  /** 操作者有沒有 `reports.show-cost`:沒有時成本與毛利欄不要放進工作表 */
  canShowCost: boolean;
}

/** 一個不含名稱的工作表(名稱由外框決定:合計固定一個名稱、分店用分店名)。 */
export type ReportSheetBody = Omit<SheetData, "name">;

/** 報表的工作表:全部分店合計 + 每家分店一張。 */
export interface ReportSheetSet {
  total: ReportSheetBody;
  /** 每家分店一張,`orgId` 對應 `context.orgs` */
  branches: readonly (ReportSheetBody & { orgId: string })[];
}

export interface ReportDefinition<TData = unknown> {
  /** 報表 key;權限 `reports.<key>` */
  key: string;
  /** 報表名稱的訊息 key(`admin` namespace 底下) */
  name: string;
  conditions: ReportConditions;
  query: ReportQuery<TData>;
  /**
   * 查詢結果 → 工作表(Excel 與預覽共用)。寫成方法簽章:各報表的 `ReportDefinition<自己的查詢結果>`
   * 才放得進同一份登記清單(`ReportDefinition` 預設的 `unknown`)。
   */
  sheets(data: TData, context: ReportSheetContext): ReportSheetSet;
}

/** 查詢 input 已經用掉的欄位名,其他條件不能撞。 */
const RESERVED_INPUT_KEYS = new Set(["periodKind", "from", "to", "orgIds"]);
const REPORT_KEY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const fail = (key: string, problem: string): never => {
  throw new Error(`registerReport("${key}"): ${problem}`);
};

const checkExtra = (
  key: string,
  conditions: ReportConditions,
  extra: ReportExtraCondition,
  seen: Set<string>,
): void => {
  if (RESERVED_INPUT_KEYS.has(extra.key) || seen.has(extra.key)) {
    fail(key, `extra condition key "${extra.key}" is reserved or duplicated`);
  }
  seen.add(extra.key);
  if (extra.only !== undefined && !conditions.period.includes(extra.only)) {
    fail(key, `extra "${extra.key}" only applies to an unavailable period`);
  }
  if (extra.type === "select" && extra.options.length === 0) {
    fail(key, `select "${extra.key}" needs at least one option`);
  }
};

/**
 * 登記一張報表:檢查宣告、原樣回傳(放進登記清單)。宣告寫錯在載入時就丟錯,不等到使用者點到:
 * key 要是 kebab-case(權限 key 的最後一段)、期間至少一種且不重複、分店上限是正整數、
 * 其他條件的 key 不重複也不撞查詢欄位、`only` 要是這張報表有的期間、下拉至少一個選項。
 */
export const registerReport = <TData>(
  def: ReportDefinition<TData>,
): ReportDefinition<TData> => {
  const { key, conditions } = def;
  if (!REPORT_KEY_PATTERN.test(key)) fail(key, "key must be kebab-case");
  const periods = new Set(conditions.period);
  if (
    periods.size === 0 ||
    periods.size !== conditions.period.length ||
    conditions.period.some((kind) => !REPORT_PERIOD_KINDS.includes(kind))
  ) {
    fail(key, "period must list distinct day / week / month");
  }
  if (!Number.isInteger(conditions.orgs.max) || conditions.orgs.max < 1) {
    fail(key, "orgs.max must be a positive integer");
  }
  const seen = new Set<string>();
  for (const extra of conditions.extra) {
    checkExtra(key, conditions, extra, seen);
  }
  return def;
};

/**
 * 工作表組合 → 交給 Excel / 預覽的工作表清單:合計在最前面(預覽預設顯示它),分店照選擇器的順序。
 * `totalName` 是「全部分店合計」(已翻譯);分店名找不到時用 id。
 */
export const reportSheetsOf = (
  set: ReportSheetSet,
  orgs: readonly ReportOrg[],
  totalName: string,
): SheetData[] => {
  const nameOf = new Map(orgs.map((org) => [org.id, org.name]));
  const orderOf = (orgId: string) => {
    const index = orgs.findIndex((org) => org.id === orgId);
    return index === -1 ? orgs.length : index;
  };
  const branches = set.branches.toSorted(
    (left, right) => orderOf(left.orgId) - orderOf(right.orgId),
  );
  return [
    { ...set.total, name: totalName },
    ...branches.map(({ orgId, ...body }) => ({
      ...body,
      name: nameOf.get(orgId) ?? orgId,
    })),
  ];
};

/** 其他條件的預設值:勾選 = false、下拉 = 第一個選項。 */
export const defaultExtraValue = (
  condition: ReportExtraCondition,
): ReportExtraValue =>
  condition.type === "boolean" ? false : (condition.options[0]?.value ?? "");

/** 這種期間類型下要顯示 / 要送的其他條件。 */
export const extraConditionsFor = (
  conditions: ReportConditions,
  kind: ReportPeriodKind,
): ReportExtraCondition[] =>
  conditions.extra.filter(
    (condition) => condition.only === undefined || condition.only === kind,
  );
