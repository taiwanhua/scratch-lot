import { useTranslations } from "use-intl";

import type { FieldDef } from "@repo/domain/form";
import {
  DEFAULT_OVERDUE_AUDIENCE,
  type OverdueReminderDef,
  type ReviewStepDef,
} from "@repo/domain/workflow";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useFieldErrorText } from "@/components/base/FieldErrorText/useFieldErrorText";

import { AudienceSourceSummary } from "./AudienceSourceSummary";
import { useApproverAudienceSetup } from "./useApproverAudienceSetup";

export interface StepOverdueSectionProps {
  step: ReviewStepDef;
  onChange: (next: ReviewStepDef) => void;
  isShared: boolean;
  /** 人員條件的「表單的組織欄位」從檢查用表單的欄位選 */
  checkFormFields: readonly FieldDef[] | null;
  /** 檢查器說時數不合法(`OVERDUE_INVALID`):欄位標紅、說明換成原因;設計器也擋存草稿 */
  hasHoursError: boolean;
  isReadonly: boolean;
}

/** 開啟時的起點:24 小時提醒審核者、48 小時通知「通知對象」(預設 = 持有改派權限的人)。 */
const DEFAULT_OVERDUE: OverdueReminderDef = {
  reviewerAfterHours: 24,
  audienceAfterHours: 48,
  audience: DEFAULT_OVERDUE_AUDIENCE,
};

/** 時數欄位:放得下三位數 + 數字微調鈕的一次性寬度(STYLE-06;兩個時數欄共用),不被說明文字擠窄。 */
const HOURS_FIELD_SX = { width: 88, flexShrink: 0 } as const;

/** 欄位字串 → 時數;空白 = 0(檢查器會指出不是正整數)。 */
const hoursOf = (text: string): number =>
  text.trim() === "" ? 0 : Number(text);

/** 時數 → 欄位字串;0 / 不是數字顯示空白(使用者正在清空重打)。 */
const textOf = (hours: number): string =>
  Number.isFinite(hours) && hours !== 0 ? String(hours) : "";

/**
 * 關卡面板「逾時提醒」區塊:預設關閉,開啟後
 * 「超過 N 小時未處理 → 通知審核者」「超過 M 小時 → 同時通知『通知對象』」+ 通知對象的人員條件
 * (摘要 + [編輯條件] 對話框,同審核者)。M 必須大於 N:不合法時欄位標紅,設計器擋下不讓存草稿。
 */
export const StepOverdueSection = ({
  step,
  onChange,
  isShared,
  checkFormFields,
  hasHoursError,
  isReadonly,
}: StepOverdueSectionProps) => {
  const t = useTranslations("admin.workflows.step.overdue");
  const setup = useApproverAudienceSetup(isShared, checkFormFields);
  const overdue = step.overdue ?? null;
  // 時數錯了的原因寫在兩格下方,並連到兩格(REACT-18)
  const hoursError = useFieldErrorText(
    hasHoursError ? t("invalid") : undefined,
  );
  const setOverdue = (next: OverdueReminderDef | null) => {
    onChange({ ...step, overdue: next });
  };

  return (
    <Stack spacing={1} role="group" aria-label={t("title")}>
      <Typography variant="subtitle2" component="h3">
        {t("title")}
      </Typography>
      <FormControlLabel
        label={t("enabled")}
        control={
          <Switch
            checked={overdue !== null}
            disabled={isReadonly}
            onChange={(_event, checked) => {
              setOverdue(checked ? DEFAULT_OVERDUE : null);
            }}
          />
        }
      />
      {overdue !== null && (
        <>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="body2" sx={{ flexShrink: 0 }}>
              {t("over")}
            </Typography>
            <TextField
              type="number"
              size="small"
              value={textOf(overdue.reviewerAfterHours)}
              error={hasHoursError}
              disabled={isReadonly}
              sx={HOURS_FIELD_SX}
              slotProps={{
                htmlInput: {
                  min: 1,
                  step: 1,
                  "aria-label": t("reviewerHours"),
                  "aria-describedby": hoursError.describedBy,
                },
              }}
              onChange={(event) => {
                setOverdue({
                  ...overdue,
                  reviewerAfterHours: hoursOf(event.target.value),
                });
              }}
            />
            <Typography variant="body2">{t("reviewerSuffix")}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="body2" sx={{ flexShrink: 0 }}>
              {t("over")}
            </Typography>
            <TextField
              type="number"
              size="small"
              value={textOf(overdue.audienceAfterHours)}
              error={hasHoursError}
              disabled={isReadonly}
              sx={HOURS_FIELD_SX}
              slotProps={{
                htmlInput: {
                  min: 1,
                  step: 1,
                  "aria-label": t("audienceHours"),
                  "aria-describedby": hoursError.describedBy,
                },
              }}
              onChange={(event) => {
                setOverdue({
                  ...overdue,
                  audienceAfterHours: hoursOf(event.target.value),
                });
              }}
            />
            <Typography variant="body2">{t("audienceSuffix")}</Typography>
          </Stack>
          {hoursError.errorText}
          <AudienceSourceSummary
            purpose="overdue"
            audience={overdue.audience}
            stepName={step.name}
            isShared={isShared}
            setup={setup}
            isDisabled={isReadonly}
            onChange={(audience) => {
              setOverdue({ ...overdue, audience });
            }}
          />
          <Typography variant="caption" color="textSecondary">
            {t("hint")}
          </Typography>
        </>
      )}
    </Stack>
  );
};
