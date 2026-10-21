import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryDealerRefFieldsFragment,
  LotteryDealerType,
  useLotteryDealersQuery,
} from "@repo/graphql";
import { Autocomplete } from "@repo/ui/autocomplete";

import { useSession } from "@/hooks/base/useSession";

export interface CoSalesPickerProps {
  label: string;
  value: LotteryDealerRefFieldsFragment | null;
  onChange: (value: LotteryDealerRefFieldsFragment | null) => void;
  error?: boolean;
  helperText?: string;
}

/** 共同銷售處所挑選器(甲類):只列出還沒解約的乙類(解約後不能再被選取)。 */
export const CoSalesPicker = ({
  label,
  value,
  onChange,
  error,
  helperText,
}: CoSalesPickerProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const { session } = useSession();
  const [keyword, setKeyword] = useState("");
  const query = useLotteryDealersQuery(session.client, {
    input: {
      type: LotteryDealerType.B,
      selectable: true,
      keyword: keyword === "" ? null : keyword,
      pageSize: 50,
    },
  });
  const candidates: LotteryDealerRefFieldsFragment[] = (
    query.data?.lotteryDealers.items ?? []
  ).map((dealer) => ({
    id: dealer.id,
    type: dealer.type,
    licenseNo: dealer.licenseNo,
    name: dealer.name,
    storeName: dealer.storeName,
    status: dealer.status,
  }));
  const options =
    value === null || candidates.some((option) => option.id === value.id)
      ? candidates
      : [value, ...candidates];
  return (
    <Autocomplete
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      onInputChange={setKeyword}
      getOptionLabel={(option) =>
        `${option.storeName ?? option.name} #${option.licenseNo}`
      }
      getOptionKey={(option) => option.id}
      loading={query.isLoading}
      loadingText={t("common.loading")}
      noOptionsText={t("common.empty")}
      error={error}
      helperText={helperText}
      size="small"
      fullWidth
    />
  );
};
