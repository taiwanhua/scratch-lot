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

/**
 * 只留值為 true 的鍵(照常審核 = 省略,不存 `false`):改成自動通過再改回照常,定義回到原樣、
 * 不會被當成未存的變更;兩項都照常審核 → 存 `null`(與省略同義,既有流程的形狀不變)。
 */
const nextAutoApprove = (
  current: AutoApproveDef | null | undefined,
  key: AutoApproveCase,
  isAuto: boolean,
): AutoApproveDef | null => {
  const merged: AutoApproveDef = { ...current, [key]: isAuto };
  const next: AutoApproveDef = Object.fromEntries(
    CASES.filter((item) => merged[item] === true).map((item) => [item, true]),
  );
  return Object.keys(next).length > 0 ? next : null;
};

/**
 * 關卡面板「自動通過」區塊:
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
          <Typography variant="body2" color="textSecondary">
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
      <Typography variant="caption" color="textSecondary">
        {t("hint")}
      </Typography>
    </Stack>
  );
};
