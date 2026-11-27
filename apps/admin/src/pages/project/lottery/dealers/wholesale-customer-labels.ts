import { LotteryWholesaleCustomerStatus } from "@repo/graphql";
import type { TagTone } from "@repo/ui/tag";

/** 狀態 → 文案 key(`admin.lotteryDealers` 底下;字面值,死鍵掃描看得到)與標籤色。 */
export const WHOLESALE_CUSTOMER_STATUS_LABELS: Record<
  LotteryWholesaleCustomerStatus,
  string
> = {
  [LotteryWholesaleCustomerStatus.Active]: "wholesale.statuses.active",
  [LotteryWholesaleCustomerStatus.Inactive]: "wholesale.statuses.inactive",
};

export const WHOLESALE_CUSTOMER_STATUS_TONES: Record<
  LotteryWholesaleCustomerStatus,
  TagTone
> = {
  [LotteryWholesaleCustomerStatus.Active]: "success",
  [LotteryWholesaleCustomerStatus.Inactive]: "grey",
};

export const WHOLESALE_CUSTOMER_STATUSES: readonly LotteryWholesaleCustomerStatus[] =
  [
    LotteryWholesaleCustomerStatus.Active,
    LotteryWholesaleCustomerStatus.Inactive,
  ];
