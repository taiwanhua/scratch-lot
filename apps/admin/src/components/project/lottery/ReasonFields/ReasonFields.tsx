import { useTranslations } from "use-intl";

import { requiresReasonNote } from "@repo/domain/project/reason-note";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { useLotteryFieldOptions } from "@/hooks/project/useLotteryFieldOptions/useLotteryFieldOptions";

import type { ReasonValue } from "./reason-value";

export interface ReasonFieldsProps {
  /** 欄位管理的原因類別 key(`LOTTERY_FIELD_CATEGORY_KEYS`) */
  categoryKey: string;
  /** 下拉的標籤(例:「更正原因(必填)」) */
  label: string;
  value: ReasonValue;
  onChange: (value: ReasonValue) => void;
  /** 標紅的欄位(api 或送出前檢查回的) */
  invalid: readonly string[];
}

/**
 * 刮刮樂的原因欄(更正跳號、尋回、報廢共用;規格第 13 章):下拉選欄位管理的原因類別(必填),
 * 下方「說明」—— 選「其他」時必填。
 */
export const ReasonFields = ({
  categoryKey,
  label,
  value,
  onChange,
  invalid,
}: ReasonFieldsProps) => {
  const t = useTranslations("admin.lotteryInventory.reason");
  const reasons = useLotteryFieldOptions(categoryKey);
  const noteRequired = requiresReasonNote(value.reasonKey);
  return (
    <Stack spacing={2}>
      <SelectField
        label={label}
        value={value.reasonKey}
        required
        fullWidth
        error={invalid.includes("reasonKey")}
        options={reasons.options}
        onChange={(next: string) => {
          onChange({ ...value, reasonKey: next });
        }}
      />
      <TextField
        label={noteRequired ? t("noteRequired") : t("note")}
        value={value.reasonNote}
        required={noteRequired}
        fullWidth
        error={invalid.includes("reasonNote")}
        onChange={(event) => {
          onChange({ ...value, reasonNote: event.target.value });
        }}
      />
    </Stack>
  );
};
