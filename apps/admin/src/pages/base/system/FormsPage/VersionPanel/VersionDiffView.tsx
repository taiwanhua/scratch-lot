import { useTranslations } from "use-intl";

import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { VersionDiff } from "@/lib/base/form-engine/version-diff";

export interface VersionDiffViewProps {
  diff: VersionDiff;
}

const labels = (fields: VersionDiff["added"]): string =>
  fields.map((field) => `${field.label}(${field.key})`).join("、");

/** 與上一版的差異:新增 / 移除 / 定義有變的欄位(以欄位 key 比對,`lib/base/form-engine/version-diff.ts`)。 */
export const VersionDiffView = ({ diff }: VersionDiffViewProps) => {
  const t = useTranslations("admin.forms.versions");

  if (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0
  ) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t("diffNone")}
      </Typography>
    );
  }

  return (
    <Stack spacing={0.5}>
      {diff.added.length > 0 && (
        <Typography variant="body2">
          {t("diffAdded", { fields: labels(diff.added) })}
        </Typography>
      )}
      {diff.removed.length > 0 && (
        <Typography variant="body2">
          {t("diffRemoved", { fields: labels(diff.removed) })}
        </Typography>
      )}
      {diff.changed.length > 0 && (
        <Typography variant="body2">
          {t("diffChanged", { fields: labels(diff.changed) })}
        </Typography>
      )}
    </Stack>
  );
};
