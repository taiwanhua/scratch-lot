import { useTranslations } from "use-intl";

import type { FieldDef } from "@repo/domain/form";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { FormValue } from "@/components/base/form-engine/FormValue";

export interface UpgradeConfirmStepProps {
  /** 將升級的筆數(各舊版本加總) */
  total: number;
  targetVersion: number;
  /** 有填值的補值欄位 */
  filled: readonly FieldDef[];
  fills: Readonly<Record<string, unknown>>;
}

/** 升級第二步:確認將升級的筆數與補值摘要(值照欄位型別顯示)。 */
export const UpgradeConfirmStep = ({
  total,
  targetVersion,
  filled,
  fills,
}: UpgradeConfirmStepProps) => {
  const t = useTranslations("admin.forms.upgrade");
  const tValue = useTranslations("admin.formEngine.renderer");
  const text = {
    empty: tValue("empty"),
    yes: tValue("yes"),
    no: tValue("no"),
    unavailable: tValue("sourceUnavailable"),
  };

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2">
        {t("confirmBody", { count: total, version: targetVersion })}
      </Typography>
      <Typography variant="subtitle2">{t("confirmFillsTitle")}</Typography>
      {filled.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("confirmNoFills")}
        </Typography>
      ) : (
        filled.map((field) => (
          <Typography key={field.key} variant="body2">
            {field.label}:
            <FormValue
              field={field}
              value={fills[field.key]}
              display={[]}
              text={text}
            />
          </Typography>
        ))
      )}
    </Stack>
  );
};
