import type {
  DealerStatus,
  DealerType,
  RentCycle,
} from "../../database/lottery-dealers/lottery-dealer.schema";
import { DEALER_REASONS, validationError } from "./dealers-error";

/**
 * 經銷商與關係人的欄位格式(專案規格 5.2、5.3;正本 `docs/modules/project/dealers.md`「資料」)。
 * 格式錯誤一律 `VALIDATION_FAILED`,`fields` 列出全部有問題的欄位(一次標完);業務規則另有 `reason`。
 */

export const LICENSE_NO_PATTERN = /^\d{8}$/;
export const NATIONAL_ID_PATTERN = /^[A-Z]\d{9}$/;
const DIGITS_PATTERN = /^\d+$/;

/** email 格式:一個 `@`、前後都有字、網域有 `.` 且不在頭尾、不含空白(不用回溯型 regex)。 */
export function isEmailLike(value: string): boolean {
  if (/\s/.test(value)) {
    return false;
  }
  const parts = value.split("@");
  if (parts.length !== 2) {
    return false;
  }
  const [local = "", domain = ""] = parts;
  const dot = domain.indexOf(".");
  return local !== "" && dot > 0 && !domain.endsWith(".");
}

export const TEXT_LIMITS = {
  name: 10,
  storeName: 30,
  businessAddress: 60,
  storePhone: 15,
  terminalNo: 20,
  phone: 15,
  mobile: 15,
  email: 60,
  mailingAddress: 60,
  residentialAddress: 60,
  note: 1000,
} as const;

/** 一次檢查收集所有出錯的欄位。 */
export class FieldErrors {
  private readonly fields: string[] = [];

  add(field: string): void {
    if (!this.fields.includes(field)) {
      this.fields.push(field);
    }
  }

  throwIfAny(subject: string): void {
    if (this.fields.length > 0) {
      throw validationError(
        `${subject}: invalid ${this.fields.join(", ")}`,
        this.fields,
      );
    }
  }
}

/** 字串:前後空白去掉;空字串 = null。 */
export function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** 選填文字:長度上限;`digitsOnly` 只能數字。 */
export function checkOptionalText(
  errors: FieldErrors,
  field: keyof typeof TEXT_LIMITS,
  value: string | null,
  options: { digitsOnly?: boolean; email?: boolean } = {},
): void {
  if (value === null) {
    return;
  }
  if (
    value.length > TEXT_LIMITS[field] ||
    (options.digitsOnly === true && !DIGITS_PATTERN.test(value)) ||
    (options.email === true && !isEmailLike(value))
  ) {
    errors.add(field);
  }
}

/** 必填文字(長度上限)。 */
export function checkRequiredText(
  errors: FieldErrors,
  field: "name",
  value: string | null,
): void {
  if (value === null || value.length > TEXT_LIMITS[field]) {
    errors.add(field);
  }
}

/** 身分證字號:大寫後 1 英文字母 + 9 碼數字。 */
export function normalizeNationalId(value: string | null): string | null {
  return value === null ? null : value.toUpperCase();
}

export function checkNationalId(
  errors: FieldErrors,
  value: string | null,
): void {
  if (value === null || !NATIONAL_ID_PATTERN.test(value)) {
    errors.add("nationalId");
  }
}

/** 經銷商主檔落庫的值(不含 `orgId` / `tenantId` / 基礎欄位、不含 `lastPurchaseDate` 兩欄)。 */
export interface DealerValues {
  type: DealerType;
  licenseNo: string;
  name: string;
  status: DealerStatus;
  licenseApprovedAt: Date;
  licenseExpiresAt: Date;
  lastPurchaseBaseDate: Date | null;
  lastSelfPurchaseBaseDate: Date | null;
  storeName: string | null;
  businessAddress: string | null;
  storePhone: string | null;
  terminalNo: string | null;
  rentFee: number | null;
  rentCycle: RentCycle | null;
  rentStartMonth: number | null;
  rentDueDay: number | null;
  nationalId: string;
  birthday: Date | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  mailingAddress: string | null;
  residentialAddress: string | null;
  residentialSameAsMailing: boolean;
  note: string | null;
}

/** 甲類 / 乙類才有的欄位(另一類一律 null)。 */
export const CLASS_A_FIELDS = [
  "lastPurchaseBaseDate",
  "lastSelfPurchaseBaseDate",
] as const;
export const CLASS_B_FIELDS = [
  "storeName",
  "businessAddress",
  "storePhone",
  "terminalNo",
  "rentFee",
  "rentCycle",
  "rentStartMonth",
  "rentDueDay",
] as const;

/** 還沒驗過的草稿(必填欄可能缺)。 */
export type DealerDraft = Omit<
  DealerValues,
  "licenseNo" | "name" | "licenseApprovedAt" | "licenseExpiresAt" | "nationalId"
> & {
  licenseNo: string | null;
  name: string | null;
  licenseApprovedAt: Date | null;
  licenseExpiresAt: Date | null;
  nationalId: string | null;
};

function checkRequiredFields(errors: FieldErrors, draft: DealerDraft): void {
  if (draft.licenseNo === null || !LICENSE_NO_PATTERN.test(draft.licenseNo)) {
    errors.add("licenseNo");
  }
  checkRequiredText(errors, "name", draft.name);
  checkNationalId(errors, draft.nationalId);
  if (draft.licenseApprovedAt === null) {
    errors.add("licenseApprovedAt");
  }
  if (draft.licenseExpiresAt === null) {
    errors.add("licenseExpiresAt");
  }
}

function checkTextFields(errors: FieldErrors, draft: DealerDraft): void {
  checkOptionalText(errors, "storeName", draft.storeName);
  checkOptionalText(errors, "businessAddress", draft.businessAddress);
  checkOptionalText(errors, "storePhone", draft.storePhone, {
    digitsOnly: true,
  });
  checkOptionalText(errors, "terminalNo", draft.terminalNo);
  checkOptionalText(errors, "phone", draft.phone, { digitsOnly: true });
  checkOptionalText(errors, "mobile", draft.mobile, { digitsOnly: true });
  checkOptionalText(errors, "email", draft.email, { email: true });
  checkOptionalText(errors, "mailingAddress", draft.mailingAddress);
  checkOptionalText(errors, "residentialAddress", draft.residentialAddress);
  checkOptionalText(errors, "note", draft.note);
}

const isIntIn = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max;

function checkRentFields(errors: FieldErrors, draft: DealerDraft): void {
  if (
    draft.rentFee !== null &&
    !isIntIn(draft.rentFee, 0, Number.MAX_SAFE_INTEGER)
  ) {
    errors.add("rentFee");
  }
  if (draft.rentStartMonth !== null && !isIntIn(draft.rentStartMonth, 1, 12)) {
    errors.add("rentStartMonth");
  }
  if (draft.rentDueDay !== null && !isIntIn(draft.rentDueDay, 1, 31)) {
    errors.add("rentDueDay");
  }
}

/** 類型不符的欄位 `NOT_FOR_TYPE`;有週期就要繳費日,季 / 年要起算月份。 */
function checkTypeRules(draft: DealerDraft): void {
  const foreign =
    draft.type === "a"
      ? CLASS_B_FIELDS.filter((field) => draft[field] !== null)
      : CLASS_A_FIELDS.filter((field) => draft[field] !== null);
  if (foreign.length > 0) {
    throw validationError(
      `fields not for class ${draft.type}: ${foreign.join(", ")}`,
      [...foreign],
      DEALER_REASONS.notForType,
    );
  }
  if (draft.type !== "b" || draft.rentCycle === null) {
    return;
  }
  if (draft.rentDueDay === null) {
    throw validationError(
      "rentDueDay is required with rentCycle",
      ["rentDueDay"],
      DEALER_REASONS.rentDueDayRequired,
    );
  }
  if (draft.rentCycle !== "month" && draft.rentStartMonth === null) {
    throw validationError(
      "rentStartMonth is required for quarter / year",
      ["rentStartMonth"],
      DEALER_REASONS.rentStartMonthRequired,
    );
  }
}

/**
 * 驗整份草稿(新增 = 空白 + input;編輯 = 目前的值 + input):格式一次標完,
 * 類型不符的欄位 `NOT_FOR_TYPE`、季 / 年沒有起算月份 `RENT_START_MONTH_REQUIRED`。
 * 「由季改成月」時起算月份不再使用:落庫改回 null。戶籍同通訊地址時存通訊地址。
 */
export function validateDealerDraft(draft: DealerDraft): DealerValues {
  const errors = new FieldErrors();
  checkRequiredFields(errors, draft);
  checkTextFields(errors, draft);
  checkRentFields(errors, draft);
  errors.throwIfAny("lottery dealer");
  checkTypeRules(draft);
  return {
    ...draft,
    licenseNo: draft.licenseNo ?? "",
    name: draft.name ?? "",
    nationalId: draft.nationalId ?? "",
    licenseApprovedAt: draft.licenseApprovedAt ?? new Date(0),
    licenseExpiresAt: draft.licenseExpiresAt ?? new Date(0),
    rentStartMonth: draft.rentCycle === "month" ? null : draft.rentStartMonth,
    residentialAddress: draft.residentialSameAsMailing
      ? draft.mailingAddress
      : draft.residentialAddress,
  };
}
