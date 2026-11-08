import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "@repo/domain/form";
import { useLotteryStoreCountModeHistoryQuery } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";

export interface CountModeHistoryDialogProps {
  orgId: string;
  orgName: string;
  onClose: () => void;
}

/**
 * 盤點制度變更紀錄(Figma CS-50h;規格第 4 節 [變更紀錄]):新到舊,每筆「時間 · 誰」與「從哪種 → 到哪種(為什麼)」。
 * 補點編號核准(之後的票寫入)沒改制度時寫「補點編號 核准(不改制度)」。
 */
export const CountModeHistoryDialog = ({
  orgId,
  orgName,
  onClose,
}: CountModeHistoryDialogProps) => {
  const t = useTranslations("admin.lotterySettings.historyDialog");
  const isMobile = useBreakpointDown("sm");
  const { session } = useSession();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const query = useLotteryStoreCountModeHistoryQuery(session.client, {
    input: { orgId },
  });
  const items = query.data?.lotteryStoreCountModeHistory.items;
  const modeText = (mode: string | null | undefined) =>
    t(`modes.${mode ?? "numbered"}`);

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={t("title", { org: orgName })}
      actions={<Button onClick={onClose}>{t("close")}</Button>}
    >
      <Stack spacing={1.5} sx={{ pt: 1 }}>
        {items?.length === 0 && (
          <Typography variant="body2" color="textSecondary">
            {t("empty")}
          </Typography>
        )}
        {items?.map((entry) => (
          <Stack
            key={`${entry.at}-${entry.cause}`}
            direction={{ xs: "column", sm: "row" }}
            spacing={{ xs: 0.25, sm: 2 }}
            sx={{ justifyContent: "space-between" }}
          >
            <Typography variant="body2" color="textSecondary">
              {t("when", {
                at: formatTemporal(entry.at, {
                  type: "monthDayTime",
                  timezone,
                }),
                by: entry.byName ?? t("system"),
              })}
            </Typography>
            <Typography variant="body2">
              {entry.cause === "renumber_approved" && entry.from === entry.to
                ? t("renumberOnly")
                : t("change", {
                    from: modeText(entry.from),
                    to: modeText(entry.to),
                    cause: t(`causes.${entry.cause}`),
                  })}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Dialog>
  );
};
