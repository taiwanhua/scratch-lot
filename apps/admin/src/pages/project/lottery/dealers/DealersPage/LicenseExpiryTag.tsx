import type { LotteryDealerFieldsFragment } from "@repo/graphql";
import { Tag } from "@repo/ui/tag";

import { useTemporalText } from "@/hooks/base/useTemporalText";

import { LICENSE_TONES } from "../dealer-labels";

export interface LicenseExpiryTagProps {
  dealer: Pick<
    LotteryDealerFieldsFragment,
    "licenseExpiresAt" | "licenseState"
  >;
}

/**
 * 列表「證照到期」欄:到期日標籤,30 天內到期警告色、已過期錯誤色(`LICENSE_TONES`,同詳情頁);
 * 側欄數字算進去的「證照快到期」就是這兩種顏色的那幾位。
 */
export const LicenseExpiryTag = ({ dealer }: LicenseExpiryTagProps) => {
  const temporal = useTemporalText();
  return (
    <Tag
      tone={LICENSE_TONES[dealer.licenseState]}
      label={temporal(dealer.licenseExpiresAt, "date")}
    />
  );
};
