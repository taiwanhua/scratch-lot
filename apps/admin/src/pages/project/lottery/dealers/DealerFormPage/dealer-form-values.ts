import {
  type LotteryDealerContactRefFieldsFragment,
  type LotteryDealerFieldsFragment,
  type LotteryDealerRefFieldsFragment,
  LotteryDealerStatus,
  LotteryDealerType,
  type LotteryRentCycle,
} from "@repo/graphql";

import type { ShareOrgValue } from "@/components/base/ShareOrgsField/ShareOrgsField";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";

/**
 * 經銷商表單的值(輸入中的字串;日期是 `YYYY-MM-DD`,送出時以租戶時區換成那天 00:00 的時點)。
 * 欄位 key 與 api input 同名,`VALIDATION_FAILED` 的 `fields` 標得回來。
 */
export interface DealerFormValues {
  type: LotteryDealerType;
  licenseNo: string;
  name: string;
  status: LotteryDealerStatus;
  licenseApprovedAt: string | null;
  licenseExpiresAt: string | null;
  lastPurchaseBaseDate: string | null;
  lastSelfPurchaseBaseDate: string | null;
  coSalesDealer: LotteryDealerRefFieldsFragment | null;
  agents: LotteryDealerContactRefFieldsFragment[];
  trustees: LotteryDealerContactRefFieldsFragment[];
  introducers: LotteryDealerContactRefFieldsFragment[];
  storeOrgId: string | null;
  storeName: string;
  businessAddress: string;
  storePhone: string;
  terminalNo: string;
  rentFee: string;
  rentCycle: LotteryRentCycle | null;
  rentStartMonth: number | null;
  rentDueDay: string;
  nationalId: string;
  birthday: string | null;
  phone: string;
  mobile: string;
  email: string;
  mailingAddress: string;
  residentialAddress: string;
  residentialSameAsMailing: boolean;
  note: string;
  /** 共用給(資料共用,ADR-0014);有 `dealers.edit` 才出現在表單上 */
  shareOrgs: ShareOrgValue[];
}

export type DealerFormKey = keyof DealerFormValues;

/** 表單 key → api input 的欄位名(關聯的幾個不同名)。 */
export const INPUT_FIELD_OF: Partial<Record<DealerFormKey, string>> = {
  coSalesDealer: "coSalesDealerId",
  agents: "agentIds",
  trustees: "trusteeIds",
  introducers: "introducerIds",
};

/** api `fields` → 表單 key。 */
export const formKeyOf = (field: string): DealerFormKey | null => {
  const relation = Object.entries(INPUT_FIELD_OF).find(
    ([, input]) => input === field,
  );
  if (relation !== undefined) {
    return relation[0] as DealerFormKey;
  }
  return field in emptyValues(LotteryDealerType.A)
    ? (field as DealerFormKey)
    : null;
};

export const emptyValues = (type: LotteryDealerType): DealerFormValues => {
  return {
    type,
    licenseNo: "",
    name: "",
    status: LotteryDealerStatus.Active,
    licenseApprovedAt: null,
    licenseExpiresAt: null,
    lastPurchaseBaseDate: null,
    lastSelfPurchaseBaseDate: null,
    coSalesDealer: null,
    agents: [],
    trustees: [],
    introducers: [],
    storeOrgId: null,
    storeName: "",
    businessAddress: "",
    storePhone: "",
    terminalNo: "",
    rentFee: "",
    rentCycle: null,
    rentStartMonth: null,
    rentDueDay: "",
    nationalId: "",
    birthday: null,
    phone: "",
    mobile: "",
    email: "",
    mailingAddress: "",
    residentialAddress: "",
    residentialSameAsMailing: false,
    note: "",
    shareOrgs: [],
  };
};

const text = (value: string | null | undefined): string => value ?? "";
const numberText = (value: number | null | undefined): string =>
  value === null || value === undefined ? "" : String(value);

export const valuesOf = (
  dealer: LotteryDealerFieldsFragment,
  timezone: string,
): DealerFormValues => {
  const day = (value: unknown) => localDayTextOf(value, timezone);
  return {
    type: dealer.type,
    licenseNo: dealer.licenseNo,
    name: dealer.name,
    status: dealer.status,
    licenseApprovedAt: day(dealer.licenseApprovedAt),
    licenseExpiresAt: day(dealer.licenseExpiresAt),
    lastPurchaseBaseDate: day(dealer.lastPurchaseBaseDate),
    lastSelfPurchaseBaseDate: day(dealer.lastSelfPurchaseBaseDate),
    coSalesDealer: dealer.coSalesDealer ?? null,
    agents: dealer.agents,
    trustees: dealer.trustees,
    introducers: dealer.introducers,
    storeOrgId: dealer.storeOrg?.id ?? null,
    storeName: text(dealer.storeName),
    businessAddress: text(dealer.businessAddress),
    storePhone: text(dealer.storePhone),
    terminalNo: text(dealer.terminalNo),
    rentFee: numberText(dealer.rentFee),
    rentCycle: dealer.rentCycle ?? null,
    rentStartMonth: dealer.rentStartMonth ?? null,
    rentDueDay: numberText(dealer.rentDueDay),
    nationalId: dealer.nationalId,
    birthday: day(dealer.birthday),
    phone: text(dealer.phone),
    mobile: text(dealer.mobile),
    email: text(dealer.email),
    mailingAddress: text(dealer.mailingAddress),
    residentialAddress: text(dealer.residentialAddress),
    residentialSameAsMailing: dealer.residentialSameAsMailing,
    note: text(dealer.note),
    shareOrgs: dealer.shareOrgs.map((entry) => ({
      orgId: entry.orgId,
      includeDescendants: entry.includeDescendants,
    })),
  };
};

/** 甲類 / 乙類才有的表單欄位(另一類不送)。 */
const CLASS_A_ONLY: ReadonlySet<DealerFormKey> = new Set<DealerFormKey>([
  "lastPurchaseBaseDate",
  "lastSelfPurchaseBaseDate",
  "coSalesDealer",
  "trustees",
]);
const CLASS_B_ONLY: ReadonlySet<DealerFormKey> = new Set<DealerFormKey>([
  "storeOrgId",
  "storeName",
  "businessAddress",
  "storePhone",
  "terminalNo",
  "rentFee",
  "rentCycle",
  "rentStartMonth",
  "rentDueDay",
]);

export const isForType = (
  key: DealerFormKey,
  type: LotteryDealerType,
): boolean =>
  type === LotteryDealerType.A
    ? !CLASS_B_ONLY.has(key)
    : !CLASS_A_ONLY.has(key);

const trimmed = (value: string): string | null => {
  const next = value.trim();
  return next === "" ? null : next;
};

const integer = (value: string): number | null => {
  const next = value.trim();
  return next === "" ? null : Number(next);
};

/** 一個表單欄位 → api input 的那一欄(值;空的 = null)。 */
const inputEntry = (
  key: DealerFormKey,
  values: DealerFormValues,
  timezone: string,
): [string, unknown] | null => {
  const day = (value: string | null) => localDayInstantOf(value, timezone);
  switch (key) {
    case "type": {
      return null;
    }
    case "coSalesDealer": {
      return ["coSalesDealerId", values.coSalesDealer?.id ?? null];
    }
    case "agents":
    case "trustees":
    case "introducers": {
      return [
        INPUT_FIELD_OF[key] ?? key,
        values[key].map((contact) => contact.id),
      ];
    }
    case "licenseApprovedAt":
    case "licenseExpiresAt":
    case "lastPurchaseBaseDate":
    case "lastSelfPurchaseBaseDate":
    case "birthday": {
      return [key, day(values[key])];
    }
    case "rentFee":
    case "rentDueDay": {
      return [key, integer(values[key])];
    }
    case "shareOrgs": {
      return [key, values.shareOrgs];
    }
    case "status":
    case "rentCycle":
    case "rentStartMonth":
    case "storeOrgId":
    case "residentialSameAsMailing": {
      return [key, values[key]];
    }
    default: {
      return [key, trimmed(values[key])];
    }
  }
};

/**
 * 送出的 input:新增送全部(空的 = null,api 視同缺席);編輯只送使用者動過的欄位(GQL-06:缺席 = 不動)。
 * 不屬於這個類型的欄位、不能改的欄位級權限欄一律不送。
 */
export const inputOf = (
  values: DealerFormValues,
  options: {
    timezone: string;
    touched: ReadonlySet<DealerFormKey> | null;
    writable: (key: DealerFormKey) => boolean;
  },
): Record<string, unknown> => {
  const entries = (Object.keys(values) as DealerFormKey[])
    .filter((key) => isForType(key, values.type) && options.writable(key))
    .filter((key) => options.touched === null || options.touched.has(key))
    .map((key) => inputEntry(key, values, options.timezone))
    .filter((entry): entry is [string, unknown] => entry !== null);
  return Object.fromEntries(entries);
};
