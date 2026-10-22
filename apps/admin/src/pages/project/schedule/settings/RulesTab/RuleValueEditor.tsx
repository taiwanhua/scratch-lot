import { useTranslations } from "use-intl";

import type { ScheduleRuleDefinition } from "@repo/domain/project/schedule-settings";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";

import { FieldErrorText } from "@/components/base/FieldErrorText/FieldErrorText";
import type { ScheduleFieldOption } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";

export interface RuleValueEditorProps {
  definition: ScheduleRuleDefinition;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  /** 不合法的欄位(`scheduleRuleValueErrors` 的結果,例 `amount`、`tiers`) */
  invalid: readonly string[];
  disabled: boolean;
  weekTemplates: readonly { id: string; name: string }[];
  taskOptions: readonly ScheduleFieldOption[];
}

const MINUTES_PER_HOUR = 60;
/** 新增一級預設休息時帶入的值(滿 4 小時 30 分) */
const NEW_TIER = { minMinutes: 240, breakMinutes: 30 };

const numberInput = (raw: string): number | string =>
  raw.trim() === "" || Number.isNaN(Number(raw)) ? raw : Number(raw);

const asText = (value: unknown): string =>
  typeof value === "number" || typeof value === "string" ? String(value) : "";

interface Tier {
  minMinutes: number;
  breakMinutes: number;
}

const tiersOf = (value: Record<string, unknown>): Tier[] =>
  Array.isArray(value.tiers)
    ? (value.tiers as unknown[]).map((tier) => {
        const record = (tier ?? {}) as Record<string, unknown>;
        return {
          minMinutes: Number(record.minMinutes ?? 0),
          breakMinutes: Number(record.breakMinutes ?? 0),
        };
      })
    : [];

/**
 * 規則編輯對話框(SC-27)的「值」:依規則定義的 `valueType` 畫對應的欄位
 * (數字、每月日期區間、週範本、寬限、預設休息分級、預設任務)。沒有值的規則(`none`)不畫。
 */
export const RuleValueEditor = ({
  definition,
  value,
  onChange,
  invalid,
  disabled,
  weekTemplates,
  taskOptions,
}: RuleValueEditorProps) => {
  const t = useTranslations("admin.schedule.rules.dialog");
  const tRules = useTranslations("admin.schedule.rules");
  const range = definition.range;
  const rangeText =
    range === null ? undefined : t("range", { min: range.min, max: range.max });
  // 欄位錯了就在欄位正下方寫原因(REACT-18):數字欄寫範圍,結束日另提醒不能早於開始日
  const rangeError =
    range === null
      ? t("errors.number")
      : t("errors.range", { min: range.min, max: range.max });
  const errorOf = (field: string): string | undefined => {
    if (!invalid.includes(field)) {
      return undefined;
    }
    return field === "endDay"
      ? t("errors.endDay", { error: rangeError })
      : rangeError;
  };

  const numberField = (field: string, label: string, helper?: string) => (
    <TextField
      key={field}
      label={label}
      type="number"
      value={asText(value[field])}
      fullWidth
      disabled={disabled}
      error={invalid.includes(field)}
      helperText={errorOf(field) ?? helper}
      slotProps={{ htmlInput: { step: range?.step ?? 1 } }}
      onChange={(event) => {
        onChange({ ...value, [field]: numberInput(event.target.value) });
      }}
    />
  );

  switch (definition.valueType) {
    case "amount": {
      return numberField(
        "amount",
        definition.unit === null
          ? t("amount")
          : t("amountWithUnit", {
              unit: tRules(`unitNames.${definition.unit}`),
            }),
        rangeText,
      );
    }
    case "dayRange": {
      return (
        <Stack direction="row" spacing={1.5}>
          {numberField("startDay", t("startDay"), rangeText)}
          {numberField("endDay", t("endDay"))}
        </Stack>
      );
    }
    case "grace": {
      return (
        <Stack direction="row" spacing={1.5}>
          {numberField("lateGraceMinutes", t("lateGraceMinutes"), rangeText)}
          {numberField("earlyLeaveGraceMinutes", t("earlyLeaveGraceMinutes"))}
        </Stack>
      );
    }
    case "weekTemplate": {
      return (
        <SelectField
          label={t("weekTemplate")}
          value={asText(value.weekTemplateId)}
          fullWidth
          disabled={disabled}
          error={invalid.includes("weekTemplateId")}
          helperText={
            invalid.includes("weekTemplateId") ? t("errors.choose") : undefined
          }
          options={[
            { value: "", label: tRules("value.notSet") },
            ...weekTemplates.map((week) => ({
              value: week.id,
              label: week.name,
            })),
          ]}
          onChange={(next) => {
            onChange({ weekTemplateId: next === "" ? null : next });
          }}
        />
      );
    }
    case "defaultTasks": {
      return (
        <Stack spacing={2}>
          {(["defaultLeaderTaskKey", "defaultHelperTaskKey"] as const).map(
            (field) => (
              <SelectField
                key={field}
                label={
                  field === "defaultLeaderTaskKey"
                    ? t("leaderTask")
                    : t("helperTask")
                }
                value={asText(value[field])}
                fullWidth
                disabled={disabled}
                error={invalid.includes(field)}
                helperText={
                  invalid.includes(field) ? t("errors.required") : undefined
                }
                options={[...taskOptions]}
                onChange={(next) => {
                  onChange({ ...value, [field]: next });
                }}
              />
            ),
          )}
        </Stack>
      );
    }
    case "breakTiers": {
      return (
        <BreakTiersEditor
          tiers={tiersOf(value)}
          disabled={disabled}
          isInvalid={invalid.includes("tiers")}
          onChange={(tiers) => {
            onChange({ tiers });
          }}
        />
      );
    }
    default: {
      return null;
    }
  }
};

interface BreakTiersEditorProps {
  tiers: readonly Tier[];
  disabled: boolean;
  isInvalid: boolean;
  onChange: (tiers: Tier[]) => void;
}

/** 預設休息:一列一級(排班滿幾小時 → 休息幾分鐘),可加可移除。 */
const BreakTiersEditor = ({
  tiers,
  disabled,
  isInvalid,
  onChange,
}: BreakTiersEditorProps) => {
  const t = useTranslations("admin.schedule.rules.dialog");
  const tCommon = useTranslations("admin.schedule.common");
  const patch = (index: number, next: Partial<Tier>) => {
    onChange(
      tiers.map((tier, at) => (at === index ? { ...tier, ...next } : tier)),
    );
  };
  return (
    <Stack spacing={1.5}>
      {tiers.map((tier, index) => (
        <Stack
          // 分級只是值的陣列、沒有穩定 id;同一筆資料只有使用者自己增刪,以位置為 key
          key={index}
          direction="row"
          spacing={1}
          sx={{ alignItems: "center" }}
        >
          <TextField
            label={t("tierMinHours")}
            type="number"
            value={String(tier.minMinutes / MINUTES_PER_HOUR)}
            disabled={disabled}
            error={isInvalid}
            slotProps={{ htmlInput: { step: 0.5 } }}
            onChange={(event) => {
              patch(index, {
                minMinutes: Math.round(
                  Number(event.target.value) * MINUTES_PER_HOUR,
                ),
              });
            }}
          />
          <TextField
            label={t("tierBreak")}
            type="number"
            value={String(tier.breakMinutes)}
            disabled={disabled}
            error={isInvalid}
            onChange={(event) => {
              patch(index, { breakMinutes: Number(event.target.value) });
            }}
          />
          {!disabled && (
            <Button
              variant="text"
              color="error"
              size="small"
              onClick={() => {
                onChange(tiers.filter((_tier, at) => at !== index));
              }}
            >
              {tCommon("remove")}
            </Button>
          )}
        </Stack>
      ))}
      {!disabled && (
        <Button
          variant="text"
          size="small"
          sx={{ alignSelf: "flex-start" }}
          onClick={() => {
            onChange([...tiers, NEW_TIER]);
          }}
        >
          {t("addTier")}
        </Button>
      )}
      <FieldErrorText text={isInvalid ? t("errors.tiers") : undefined} />
    </Stack>
  );
};
