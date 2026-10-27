import type { Types } from "mongoose";

import type { DealerType } from "../../database/lottery-dealers/lottery-dealer.schema";
import { REDACTED } from "./dealer-keys";
import {
  CONTACT_ROLES_IN_ORDER,
  type DealerLinks,
  ROLE_FIELDS,
  toObjectId,
  toObjectIds,
} from "./dealer-links.service";
import type { DealerRecord } from "./dealer-mapper";
import {
  type DealerDraft,
  type DealerValues,
  normalizeNationalId,
  trimToNull,
} from "./dealer-validation";
import type {
  CreateLotteryDealerInput,
  UpdateLotteryDealerInput,
} from "./dto/lottery-dealer.input";

type DealerInput = CreateLotteryDealerInput | UpdateLotteryDealerInput;

/** 必填欄位:送 `null` 視同缺席(沒有「清空」可言)。 */
const REQUIRED_FIELDS = [
  "licenseNo",
  "name",
  "status",
  "licenseApprovedAt",
  "licenseExpiresAt",
  "nationalId",
] as const;

const TEXT_FIELDS = [
  "licenseNo",
  "name",
  "storeName",
  "businessAddress",
  "storePhone",
  "terminalNo",
  "phone",
  "mobile",
  "email",
  "mailingAddress",
  "residentialAddress",
  "note",
] as const;

/** 草稿裡會被 input 改到的欄位(類型不在內:建立後唯讀)。 */
export const DRAFT_FIELDS = [
  ...REQUIRED_FIELDS,
  "lastPurchaseBaseDate",
  "lastSelfPurchaseBaseDate",
  "storeName",
  "businessAddress",
  "storePhone",
  "terminalNo",
  "rentFee",
  "rentCycle",
  "rentStartMonth",
  "rentDueDay",
  "birthday",
  "phone",
  "mobile",
  "email",
  "mailingAddress",
  "residentialAddress",
  "residentialSameAsMailing",
  "note",
] as const satisfies readonly (keyof DealerValues)[];

/** 兩個欄位級權限欄(稽核一律 `[redacted]`)。 */
export const PROTECTED_FIELDS = [
  "lastPurchaseBaseDate",
  "lastSelfPurchaseBaseDate",
] as const;

function blankDraft(type: DealerType): DealerDraft {
  return {
    type,
    licenseNo: null,
    name: null,
    status: "active",
    licenseApprovedAt: null,
    licenseExpiresAt: null,
    lastPurchaseBaseDate: null,
    lastSelfPurchaseBaseDate: null,
    storeName: null,
    businessAddress: null,
    storePhone: null,
    terminalNo: null,
    rentFee: null,
    rentCycle: null,
    rentStartMonth: null,
    rentDueDay: null,
    nationalId: null,
    birthday: null,
    phone: null,
    mobile: null,
    email: null,
    mailingAddress: null,
    residentialAddress: null,
    residentialSameAsMailing: false,
    note: null,
  };
}

/** 目前的值 → 草稿。 */
export function draftOf(record: DealerRecord): DealerDraft {
  const draft = blankDraft(record.type);
  for (const field of DRAFT_FIELDS) {
    (draft as unknown as Record<string, unknown>)[field] = record[field];
  }
  return draft;
}

function normalized(field: string, value: unknown): unknown {
  if ((TEXT_FIELDS as readonly string[]).includes(field)) {
    return trimToNull(value as string);
  }
  if (field === "nationalId") {
    return normalizeNationalId(trimToNull(value as string));
  }
  return value;
}

/**
 * 草稿 + input:缺席 = 不動;`null` = 清空(必填欄位視同缺席);有值 = 正規化後寫入。
 * 新增時 `base` 是空白草稿。
 */
export function applyInput(base: DealerDraft, input: DealerInput): DealerDraft {
  const next = { ...base } as unknown as Record<string, unknown>;
  const given = input as unknown as Record<string, unknown>;
  for (const field of DRAFT_FIELDS) {
    const value = given[field];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      if (!(REQUIRED_FIELDS as readonly string[]).includes(field)) {
        next[field] = field === "residentialSameAsMailing" ? false : null;
      }
      continue;
    }
    next[field] = normalized(field, value);
  }
  return next as unknown as DealerDraft;
}

export function newDraft(input: CreateLotteryDealerInput): DealerDraft {
  return applyInput(blankDraft(input.type), input);
}

/** input 的關聯欄位 → 最後要的關聯(缺席 = 沿用 `current`)。 */
export function desiredLinks(
  current: DealerLinks,
  input: DealerInput,
): DealerLinks {
  const contacts = { ...current.contacts };
  for (const role of CONTACT_ROLES_IN_ORDER) {
    const field = ROLE_FIELDS[role] as
      "agentIds" | "trusteeIds" | "introducerIds";
    const ids = input[field];
    if (ids !== undefined) {
      contacts[role] = ids === null ? [] : toObjectIds(ids, field);
    }
  }
  return {
    coSalesDealerId: idOrKeep(
      input.coSalesDealerId,
      current.coSalesDealerId,
      "coSalesDealerId",
    ),
    contacts,
    storeOrgId: idOrKeep(input.storeOrgId, current.storeOrgId, "storeOrgId"),
  };
}

/** 單一關聯欄位:缺席 = 沿用、`null` = 解除、有值 = 換成那一個。 */
function idOrKeep(
  given: string | null | undefined,
  current: Types.ObjectId | null,
  field: string,
): Types.ObjectId | null {
  if (given === undefined) {
    return current;
  }
  return given === null ? null : toObjectId(given, field);
}

/** 稽核的值:日期轉字串、欄位級權限欄一律 `[redacted]`。 */
function auditValue(field: string, value: unknown): unknown {
  if ((PROTECTED_FIELDS as readonly string[]).includes(field)) {
    return REDACTED;
  }
  return value instanceof Date ? value.toISOString() : value;
}

const sameValue = (left: unknown, right: unknown): boolean =>
  left instanceof Date && right instanceof Date
    ? left.getTime() === right.getTime()
    : left === right;

/** 變更:要 `$set` 的欄位與稽核的前後值(只放有變的;欄位級權限欄 `[redacted]`)。 */
export function changesOf(
  before: DealerDraft,
  after: DealerValues,
): {
  set: Record<string, unknown>;
  auditBefore: Record<string, unknown>;
  auditAfter: Record<string, unknown>;
} {
  const set: Record<string, unknown> = {};
  const auditBefore: Record<string, unknown> = {};
  const auditAfter: Record<string, unknown> = {};
  for (const field of DRAFT_FIELDS) {
    const from = before[field];
    const to = after[field];
    if (sameValue(from, to)) {
      continue;
    }
    set[field] = to;
    auditBefore[field] = auditValue(field, from);
    auditAfter[field] = auditValue(field, to);
  }
  return { set, auditBefore, auditAfter };
}

/** 新增的稽核:有值的欄位(欄位級權限欄 `[redacted]`)。 */
export function createdAudit(values: DealerValues): Record<string, unknown> {
  const after: Record<string, unknown> = { type: values.type };
  for (const field of DRAFT_FIELDS) {
    const value = values[field];
    if (value !== null && value !== false) {
      after[field] = auditValue(field, value);
    }
  }
  return after;
}
