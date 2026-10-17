import { useTranslations } from "use-intl";

import type { AutoApproveDef, ReviewStepDef } from "@repo/domain/workflow";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export interface StepAutoApproveSectionProps {
  step: ReviewStepDef;
  onChange: (next: ReviewStepDef) => void;
  isReadonly: boolean;
}

/** 兩個情況(`AutoApproveDef` 的兩個開關),畫面由上而下照這個順序。 */
const CASES = ["applicant", "priorApprover"] as const;

type AutoApproveCase = (typeof CASES)[number];

/** 兩項都照常審核 → 存 `null`(與省略同義,既有流程的形狀不變)。 */
const nextAutoApprove = (
  current: AutoApproveDef | null | undefined,
  key: AutoApproveCase,
  isAuto: boolean,
): AutoApproveDef | null => {
  const next: AutoApproveDef = { ...current, [key]: isAuto };
  return next.applicant === true || next.priorApprover === true ? next : null;
};

/**
 * 關卡面板「自動通過」區塊(《底座規格》3.5 B5;Figma BS-03):
 * 「申請人是這一關的審核者時」「審核者已在前面的關卡核准過時」各一組 ● 照常審核(預設)○ 自動通過。
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
          <Typography variant="body2" color="text.secondary">
            {t(key)}
          </Typography>
          <RadioGroup
            row
            aria-label={t(key)}
            value={step.autoApprove?.[key] === true ? "auto" : "normal"}
            onChange={(_event, value) => {
              onChange({
                ...step,
                autoApprove: nextAutoApprove(
                  step.autoApprove,
                  key,
                  value === "auto",
                ),
              });
            }}
          >
            <FormControlLabel
              value="normal"
              control={<Radio disabled={isReadonly} />}
              label={t("normal")}
            />
            <FormControlLabel
              value="auto"
              control={<Radio disabled={isReadonly} />}
              label={t("auto")}
            />
          </RadioGroup>
        </Stack>
      ))}
      <Typography variant="caption" color="text.secondary">
        {t("hint")}
      </Typography>
    </Stack>
  );
};
