import { useTranslations } from "use-intl";

import type { UpgradeFormSubmissionsMutation } from "@repo/graphql";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

export type UpgradeResult =
  UpgradeFormSubmissionsMutation["upgradeFormSubmissions"];

export interface UpgradeResultStepProps {
  result: UpgradeResult;
}

const SKIP_REASONS = [
  "EDIT_CONFLICT",
  "DOCUMENT_TOO_LARGE",
  "VALUES_INVALID",
] as const;

type SkipReason = (typeof SKIP_REASONS)[number];

const isSkipReason = (reason: string): reason is SkipReason =>
  (SKIP_REASONS as readonly string[]).includes(reason);

/** 升級第三步:各舊版本升級了幾筆、跳過幾筆與原因。 */
export const UpgradeResultStep = ({ result }: UpgradeResultStepProps) => {
  const t = useTranslations("admin.forms.upgrade");
  return (
    <Stack spacing={1.5}>
      <Stack component="section" spacing={0.5} aria-label={t("resultUpgraded")}>
        <Typography variant="subtitle2">{t("resultUpgraded")}</Typography>
        {result.upgraded.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            {t("resultNoneUpgraded")}
          </Typography>
        ) : (
          result.upgraded.map((group) => (
            <Typography key={group.fromVersion} variant="body2">
              {t("resultUpgradedLine", {
                version: group.fromVersion,
                count: group.count,
              })}
            </Typography>
          ))
        )}
      </Stack>
      {result.skipped.length > 0 && (
        <Stack
          component="section"
          spacing={0.5}
          aria-label={t("resultSkipped")}
        >
          <Typography variant="subtitle2">{t("resultSkipped")}</Typography>
          {result.skipped.map((skip) => (
            <Typography key={skip.reason} variant="body2">
              {t("resultSkippedLine", {
                reason: isSkipReason(skip.reason)
                  ? t(`skipReasons.${skip.reason}`)
                  : skip.reason,
                count: skip.count,
              })}
            </Typography>
          ))}
        </Stack>
      )}
    </Stack>
  );
};
