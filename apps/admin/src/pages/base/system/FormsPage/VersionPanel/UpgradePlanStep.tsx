import { useTranslations } from "use-intl";

import type { FieldDef } from "@repo/domain/form";
import type { FormUpgradePlanQuery } from "@repo/graphql";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { TypedValueInput } from "@/components/base/form-engine/TypedValueInput/TypedValueInput";

export type UpgradePlan = FormUpgradePlanQuery["formUpgradePlan"];

export interface UpgradePlanStepProps {
  formKey: string;
  targetVersion: number;
  plan: UpgradePlan;
  fillTargets: readonly FieldDef[];
  fills: Readonly<Record<string, unknown>>;
  onFillChange: (fieldKey: string, value: unknown) => void;
}

/**
 * 升級第一步:各舊版本的筆數 + 補值欄位。補值輸入框依欄位型別與元件呈現(`TypedValueInput`,存值形狀):
 * 單選是單選下拉、多選是多選、日期是 DatePicker、是否是是 / 否;選項查目標版的定義。
 * 明細列 / 上傳 / 引用不列入補值(api 的補值欄位清單已排除)。
 */
export const UpgradePlanStep = ({
  formKey,
  targetVersion,
  plan,
  fillTargets,
  fills,
  onFillChange,
}: UpgradePlanStepProps) => {
  const t = useTranslations("admin.forms.upgrade");

  return (
    <Stack spacing={2}>
      <Stack component="section" spacing={0.5} aria-label={t("groupsTitle")}>
        <Typography variant="subtitle2">{t("groupsTitle")}</Typography>
        {plan.groups.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("nothing")}
          </Typography>
        ) : (
          plan.groups.map((group) => (
            <Typography key={group.fromVersion} variant="body2">
              {t("groupLine", {
                version: group.fromVersion,
                count: group.count,
              })}
            </Typography>
          ))
        )}
      </Stack>
      {plan.groups.length > 0 && (
        <Stack component="section" spacing={1.5} aria-label={t("fillsTitle")}>
          <Typography variant="subtitle2">{t("fillsTitle")}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t("fillsHint")}
          </Typography>
          {fillTargets.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("noFills")}
            </Typography>
          ) : (
            fillTargets.map((field) => (
              <TypedValueInput
                key={field.key}
                field={field}
                value={fills[field.key] ?? null}
                label={field.label}
                formKey={formKey}
                version={targetVersion}
                emptyLabel={t("fillEmpty")}
                onChange={(value) => {
                  onFillChange(field.key, value);
                }}
              />
            ))
          )}
        </Stack>
      )}
    </Stack>
  );
};
