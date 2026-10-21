import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  DEFAULT_TENANT_TIMEZONE,
  SERIAL_DIGITS,
  SERIAL_PERIODS,
  type SerialFormat,
  type SerialPeriod,
  type SerialSeparator,
  formatSerial,
  serialFormatIssues,
  serialPeriodKeyOf,
} from "@repo/domain/form";
import {
  type FormFieldsFragment,
  type UpdateFormMutation,
  useUpdateFormMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { formErrorOf } from "@/lib/base/form-engine/form-errors";

export interface SerialFormatFieldProps {
  form: FormFieldsFragment;
  onChanged: () => void;
}

/** 分隔符選項(值 → 字典鍵;空字串 = 不分隔)。 */
const SEPARATOR_OPTIONS: readonly { value: SerialSeparator; key: string }[] = [
  { value: "-", key: "dash" },
  { value: "_", key: "underscore" },
  { value: "/", key: "slash" },
  { value: ".", key: "dot" },
  { value: "", key: "none" },
];

/** 打開開關時的預設格式(例 `-202610-0001`,前綴由設計者填)。 */
const DEFAULT_FORMAT: SerialFormat = {
  prefix: "",
  period: "month",
  digits: 4,
  separator: "-",
};

const formatOf = (form: FormFieldsFragment): SerialFormat | null =>
  form.serial === null || form.serial === undefined
    ? null
    : {
        prefix: form.serial.prefix,
        period: form.serial.period as SerialPeriod,
        digits: form.serial.digits,
        separator: (form.serial.separator ?? "-") as SerialSeparator,
      };

/**
 * 表單設定「單號」:表單層的設定(不隨版本、不必發布),以 `updateForm` 的 `serial` 存。
 * 打開 = 第一次送出時給號(存草稿不給、給了不收回);前綴 / 期間 / 位數 / 分隔符,下方即時預覽。
 * 關掉立刻存(`serial: null`,已給的號碼保留);改格式按 [儲存單號格式]。
 * 改得動 = `abilities.canEdit`;改不動的人看得到目前的設定但不能改。
 */
export const SerialFormatField = ({
  form,
  onChanged,
}: SerialFormatFieldProps) => {
  const t = useTranslations("admin.forms.detail");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const saved = formatOf(form);
  const [isOn, setIsOn] = useState(saved !== null);
  const [draft, setDraft] = useState<SerialFormat>(saved ?? DEFAULT_FORMAT);
  // 預覽用的期間:打開頁面當下(只是例子,實際期間以送出時點、租戶時區為準)
  const [openedAt] = useState(() => Date.now());
  const update = useUpdateFormMutation(
    session.client,
    useMutationFeedback<UpdateFormMutation>({
      success: (payload) =>
        payload.updateForm.form.serial === null ||
        payload.updateForm.form.serial === undefined
          ? t("serialCleared")
          : t("serialSaved"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: onChanged,
    }),
  );
  const isReadonly = !form.abilities.canEdit || update.isPending;
  const issues = serialFormatIssues(draft);
  const hasIssue = (path: string) =>
    issues.some((issue) => issue.path === path);
  const example = formatSerial(
    draft,
    serialPeriodKeyOf(draft.period, openedAt, DEFAULT_TENANT_TIMEZONE),
    1,
  );
  const isUnchanged =
    saved !== null && JSON.stringify(saved) === JSON.stringify(draft);

  return (
    <Stack spacing={1} role="group" aria-label={t("serial")}>
      <FormControlLabel
        label={t("serialEnabled")}
        control={
          <Switch
            checked={isOn}
            disabled={isReadonly}
            onChange={(_event, checked) => {
              setIsOn(checked);
              if (!checked && saved !== null) {
                update.mutate({ input: { key: form.key, serial: null } });
              }
            }}
          />
        }
      />
      <Typography variant="caption" color="text.secondary">
        {t("serialHint")}
      </Typography>
      {isOn && (
        <>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap", alignItems: "flex-start" }}
          >
            <TextField
              label={t("serialPrefix")}
              size="small"
              value={draft.prefix}
              disabled={isReadonly}
              error={hasIssue("prefix")}
              helperText={t("serialPrefixHint")}
              onChange={(event) => {
                setDraft({ ...draft, prefix: event.target.value.trim() });
              }}
              sx={{ width: { xs: "100%", sm: 160 } }}
            />
            <SelectField<SerialPeriod>
              label={t("serialPeriod")}
              size="small"
              value={draft.period}
              disabled={isReadonly}
              options={SERIAL_PERIODS.map((period) => ({
                value: period,
                label: t(`serialPeriods.${period}`),
              }))}
              onChange={(period) => {
                setDraft({ ...draft, period });
              }}
              sx={{ width: { xs: "100%", sm: 160 } }}
            />
            <TextField
              label={t("serialDigits")}
              type="number"
              size="small"
              value={String(draft.digits)}
              disabled={isReadonly}
              error={hasIssue("digits")}
              slotProps={{
                htmlInput: { min: SERIAL_DIGITS.min, max: SERIAL_DIGITS.max },
              }}
              onChange={(event) => {
                setDraft({ ...draft, digits: Number(event.target.value) });
              }}
              sx={{ width: { xs: "100%", sm: 100 } }}
            />
            <SelectField<string>
              label={t("serialSeparator")}
              size="small"
              value={
                SEPARATOR_OPTIONS.find(
                  (option) => option.value === (draft.separator ?? "-"),
                )?.key ?? "dash"
              }
              disabled={isReadonly}
              options={SEPARATOR_OPTIONS.map((option) => ({
                value: option.key,
                label: t(`serialSeparators.${option.key}`),
              }))}
              onChange={(key) => {
                const picked = SEPARATOR_OPTIONS.find(
                  (option) => option.key === key,
                );
                setDraft({ ...draft, separator: picked?.value ?? "-" });
              }}
              sx={{ width: { xs: "100%", sm: 120 } }}
            />
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap", alignItems: "center" }}
          >
            <Typography variant="body2">
              {t("serialPreview", { example })}
            </Typography>
            <Button
              size="small"
              disabled={isReadonly || issues.length > 0 || isUnchanged}
              onClick={() => {
                update.mutate({
                  input: {
                    key: form.key,
                    serial: {
                      prefix: draft.prefix,
                      period: draft.period,
                      digits: draft.digits,
                      separator: draft.separator ?? "-",
                    },
                  },
                });
              }}
            >
              {t("serialSave")}
            </Button>
          </Stack>
        </>
      )}
    </Stack>
  );
};
