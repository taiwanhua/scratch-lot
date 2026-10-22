import { useTranslations } from "use-intl";

import {
  APPLICANT_REVIEW,
  type AutoApproveDef,
  type ReviewStepDef,
} from "@repo/domain/workflow";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface StepAutoApproveSectionProps {
  step: ReviewStepDef;
  onChange: (next: ReviewStepDef) => void;
  isReadonly: boolean;
}

/** 兩個情況(`AutoApproveDef` 的兩個鍵),畫面由上而下照這個順序。 */
const CASES = ["applicant", "priorApprover"] as const;

type AutoApproveCase = (typeof CASES)[number];

/**
 * 每個情況的選項(第一個是預設 = 不存)與存值:
 * - 申請人是審核者時:剔除申請人(預設)/ 自動通過(`true`)/ 照常審核(`"review"`,申請人留在名單自己審)
 * - 已在前關核准過時:照常審核(預設)/ 自動通過(`true`)
 */
const OPTIONS: Record<
  AutoApproveCase,
  readonly {
    value: string;
    label: "exclude" | "normal" | "auto";
    stored: AutoApproveDef[AutoApproveCase];
  }[]
> = {
  applicant: [
    { value: "exclude", label: "exclude", stored: undefined },
    { value: "auto", label: "auto", stored: true },
    { value: "review", label: "normal", stored: APPLICANT_REVIEW },
  ],
  priorApprover: [
    { value: "normal", label: "normal", stored: undefined },
    { value: "auto", label: "auto", stored: true },
  ],
};

/** 目前存值對應的選項 value(不認得的值當預設)。 */
const selectedOf = (
  current: AutoApproveDef | null | undefined,
  key: AutoApproveCase,
): string => {
  const options = OPTIONS[key];
  const stored = current?.[key];
  return (
    options.find(
      (option) => option.stored !== undefined && option.stored === stored,
    )?.value ?? options[0]?.value
  );
};

/**
 * 只留非預設的鍵(預設 = 省略,不存 `false`):改成別的再改回預設,定義回到原樣、不會被當成未存的變更;
 * 兩項都預設 → 存 `null`(與省略同義,既有流程的形狀不變)。
 */
const nextAutoApprove = (
  current: AutoApproveDef | null | undefined,
  key: AutoApproveCase,
  value: string,
): AutoApproveDef | null => {
  const stored = OPTIONS[key].find((option) => option.value === value)?.stored;
  const merged: Record<string, unknown> = { ...current, [key]: stored };
  const next = Object.fromEntries(
    CASES.flatMap((item) => {
      const kept = merged[item];
      return kept === true || kept === APPLICANT_REVIEW ? [[item, kept]] : [];
    }),
  ) as AutoApproveDef;
  return Object.keys(next).length > 0 ? next : null;
};

/**
 * 關卡面板「自動通過」區塊:
 * 「申請人是這一關的審核者時」● 剔除申請人(預設)○ 自動通過 ○ 照常審核;
 * 「審核者已在前面的關卡核准過時」● 照常審核(預設)○ 自動通過。
 */
export const StepAutoApproveSection = ({
  step,
  onChange,
  isReadonly,
}: StepAutoApproveSectionProps) => {
  const t = useTranslations("admin.workflows.step.autoApprove");

  return (
    <Stack spacing={0.5} role="group" aria-label={t("title")}>
      <Typography variant="subtitle2" component="h3">
        {t("title")}
      </Typography>
      {CASES.map((key) => (
        <Stack key={key} spacing={0}>
          <Typography variant="body2" color="textSecondary">
            {t(key)}
          </Typography>
          <RadioGroup
            row
            aria-label={t(key)}
            value={selectedOf(step.autoApprove, key)}
            onChange={(_event, value) => {
              onChange({
                ...step,
                autoApprove: nextAutoApprove(step.autoApprove, key, value),
              });
            }}
          >
            {OPTIONS[key].map((option) => (
              <FormControlLabel
                key={option.value}
                value={option.value}
                control={<Radio disabled={isReadonly} />}
                label={t(option.label)}
              />
            ))}
          </RadioGroup>
        </Stack>
      ))}
      <Typography variant="caption" color="textSecondary">
        {t("hint")}
      </Typography>
    </Stack>
  );
};
