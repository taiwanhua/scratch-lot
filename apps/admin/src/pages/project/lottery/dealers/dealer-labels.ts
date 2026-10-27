import {
  LotteryContactRole,
  LotteryContactStatus,
  LotteryDealerStatus,
  LotteryDealerType,
  LotteryLicenseState,
  LotteryRentCycle,
  LotterySigninState,
} from "@repo/graphql";
import type { TagTone } from "@repo/ui/tag";

import { PURCHASE_OVERDUE_DAYS, PURCHASE_WARNING_DAYS } from "./dealers-keys";

/**
 * 列舉值 → 文案 key(`admin.lotteryDealers` 底下)與標籤色。寫成字面值:死鍵掃描(`packages/i18n`)
 * 看得到,也不必在白名單登記動態前綴。
 */

export const DEALER_TYPE_LABELS: Record<LotteryDealerType, string> = {
  [LotteryDealerType.A]: "types.a",
  [LotteryDealerType.B]: "types.b",
};

export const DEALER_STATUS_LABELS: Record<LotteryDealerStatus, string> = {
  [LotteryDealerStatus.Active]: "statuses.active",
  [LotteryDealerStatus.Suspended]: "statuses.suspended",
  [LotteryDealerStatus.Terminated]: "statuses.terminated",
};

export const DEALER_STATUS_TONES: Record<LotteryDealerStatus, TagTone> = {
  [LotteryDealerStatus.Active]: "success",
  [LotteryDealerStatus.Suspended]: "grey",
  [LotteryDealerStatus.Terminated]: "error",
};

export const DEALER_STATUSES: readonly LotteryDealerStatus[] = [
  LotteryDealerStatus.Active,
  LotteryDealerStatus.Suspended,
  LotteryDealerStatus.Terminated,
];

export const CONTACT_ROLE_LABELS: Record<LotteryContactRole, string> = {
  [LotteryContactRole.Trustee]: "roles.trustee",
  [LotteryContactRole.Agent]: "roles.agent",
  [LotteryContactRole.Introducer]: "roles.introducer",
};

/** 衝突清單的身分是 api 落庫的小寫值。 */
export const CONFLICT_ROLE_LABELS: Record<string, string> = {
  trustee: "roles.trustee",
  agent: "roles.agent",
  introducer: "roles.introducer",
};

export const CONTACT_ROLES: readonly LotteryContactRole[] = [
  LotteryContactRole.Trustee,
  LotteryContactRole.Agent,
  LotteryContactRole.Introducer,
];

export const CONTACT_STATUS_LABELS: Record<LotteryContactStatus, string> = {
  [LotteryContactStatus.Active]: "contactStatuses.active",
  [LotteryContactStatus.Disabled]: "contactStatuses.disabled",
};

export const RENT_CYCLE_LABELS: Record<LotteryRentCycle, string> = {
  [LotteryRentCycle.Month]: "rentCycles.month",
  [LotteryRentCycle.Quarter]: "rentCycles.quarter",
  [LotteryRentCycle.Year]: "rentCycles.year",
};

export const RENT_CYCLES: readonly LotteryRentCycle[] = [
  LotteryRentCycle.Month,
  LotteryRentCycle.Quarter,
  LotteryRentCycle.Year,
];

export const SIGNIN_STATE_LABELS: Record<LotterySigninState, string> = {
  [LotterySigninState.Signed]: "signins.states.signed",
  [LotterySigninState.Missing]: "signins.states.missing",
  [LotterySigninState.Open]: "signins.states.open",
  [LotterySigninState.NotStarted]: "signins.states.notStarted",
};

export const SIGNIN_STATE_TONES: Record<LotterySigninState, TagTone> = {
  [LotterySigninState.Signed]: "success",
  [LotterySigninState.Missing]: "warning",
  [LotterySigninState.Open]: "grey",
  [LotterySigninState.NotStarted]: "grey",
};

export const LICENSE_TONES: Record<LotteryLicenseState, TagTone> = {
  [LotteryLicenseState.Ok]: "grey",
  [LotteryLicenseState.Expiring]: "warning",
  [LotteryLicenseState.Expired]: "error",
};

/** 距批購 N 天的標籤色:超過 150 天警告、超過 180 天錯誤;無紀錄一般色(規格 5.2;側欄數字也不算它)。 */
export const purchaseTone = (days: number | null): TagTone => {
  if (days === null) {
    return "grey";
  }
  if (days > PURCHASE_OVERDUE_DAYS) {
    return "error";
  }
  return days > PURCHASE_WARNING_DAYS ? "warning" : "grey";
};
