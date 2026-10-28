import { useTranslations } from "use-intl";

import { BANK_TRANSACTION_TYPES } from "@repo/domain/project/lottery-accounts";
import { Box } from "@repo/ui/box";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";

import { FilterDrawer } from "@/components/base/FilterDrawer/FilterDrawer";
import { DateFilterPicker } from "@/components/project/DateFilterPicker/DateFilterPicker";

import {
  EMPTY_TRANSACTION_FILTERS,
  type TransactionFilters,
  periodFromOf,
  periodToOf,
} from "./transaction-period";

/**
 * 帳戶詳情交易清單的篩選(期間起、期間迄、類型):
 * - 平板以上:攤在交易卡片頂部,改了立刻套用
 * - 手機(規格 16.0;Figma AC-02b 739:1876):卡片頂部靠右 [篩選],欄位收進底部抽屜(改草稿,按 [套用] 才寫回)
 */
export const TransactionFiltersBar = ({
  value,
  today,
  onChange,
}: {
  value: TransactionFilters;
  today: string | null;
  onChange: (next: TransactionFilters) => void;
}) => {
  const t = useTranslations("admin.lotteryAccounts");
  const isMobile = useBreakpointDown("sm");
  const typeOptions: { value: string; label: string }[] = [
    { value: "", label: t("accountView.filters.all") },
    ...BANK_TRANSACTION_TYPES.map((type) => ({
      value: type,
      label: t(`transactionTypes.${type}`),
    })),
  ];

  const renderFields = (
    current: TransactionFilters,
    change: (next: TransactionFilters) => void,
  ) => (
    <>
      <Box sx={{ maxWidth: { sm: 180 } }}>
        <DateFilterPicker
          label={t("accountView.filters.from")}
          value={periodFromOf(current.from, today)}
          size="small"
          onChange={(next) => {
            change({ ...current, from: next ?? "" });
          }}
        />
      </Box>
      <Box sx={{ maxWidth: { sm: 180 } }}>
        <DateFilterPicker
          label={t("accountView.filters.to")}
          value={periodToOf(current.to, today)}
          size="small"
          onChange={(next) => {
            change({ ...current, to: next ?? "" });
          }}
        />
      </Box>
      <SelectField
        label={t("accountView.filters.type")}
        value={current.type}
        size="small"
        displayEmpty
        options={typeOptions}
        onChange={(next: string) => {
          change({ ...current, type: next });
        }}
        sx={{ minWidth: 160 }}
      />
    </>
  );

  if (!isMobile) {
    return (
      <Stack direction="row" spacing={2}>
        {renderFields(value, onChange)}
      </Stack>
    );
  }
  return (
    <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
      <FilterDrawer
        value={value}
        emptyValue={EMPTY_TRANSACTION_FILTERS}
        activeCount={
          (value.from === "" ? 0 : 1) +
          (value.to === "" ? 0 : 1) +
          (value.type === "" ? 0 : 1)
        }
        onApply={onChange}
        renderFields={renderFields}
      />
    </Box>
  );
};
