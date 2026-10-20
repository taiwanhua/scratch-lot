import { useTranslations } from "use-intl";

import { useLotteryOccupiedStoresQuery } from "@repo/graphql";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useSession } from "@/hooks/base/useSession";

export interface StoreOrgPickerProps {
  label: string;
  value: string | null;
  onChange: (orgId: string | null) => void;
  /** 編輯中的乙類(自己對應的分店不算占用) */
  dealerId: string | null;
  error?: boolean;
  helperText?: string;
}

/**
 * 對應分店(`org_lottery_dealer`,一對一;規格 5.4):已由其他乙類對應的分店在樹上停用,
 * 右側註明「已由 某某 對應」(`OrgTreeSelect` 的 `disabledReasons`)。
 */
export const StoreOrgPicker = ({
  label,
  value,
  onChange,
  dealerId,
  error,
  helperText,
}: StoreOrgPickerProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const { session } = useSession();
  const occupied = useLotteryOccupiedStoresQuery(session.client);
  const disabledReasons = Object.fromEntries(
    (occupied.data?.lotteryOccupiedStores.items ?? [])
      .filter((item) => item.dealer.id !== dealerId)
      .map((item) => [
        item.orgId,
        t("form.occupied", {
          name: item.dealer.storeName ?? item.dealer.name,
        }),
      ]),
  );
  return (
    <OrgTreeSelect
      label={label}
      value={value === null ? [] : [value]}
      onChange={(ids) => {
        onChange(ids.at(0) ?? null);
      }}
      disabledReasons={disabledReasons}
      error={error}
      helperText={helperText}
      size="small"
      fullWidth
    />
  );
};
