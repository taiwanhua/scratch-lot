import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "@repo/domain/form";
import { useLotteryPeriodCloseQuery } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";

import { PeriodSnapshotList } from "./PeriodSnapshotList";

/**
 * 已關帳月份的 [快照](規格 10.4 `snapshot`):關帳的人與時間、每個帳戶月底餘額、每家分店小金庫 / 抽屜、
 * 沒有被日結涵蓋計算的班。只看,不能重新開帳。內容是明細清單,手機全螢幕(規格 16.0)。
 */
export const PeriodSnapshotDialog = ({
  month,
  onClose,
}: {
  month: string;
  onClose: () => void;
}) => {
  const t = useTranslations("admin.lotteryAccounts.periodClose");
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const query = useLotteryPeriodCloseQuery(session.client, { month });
  const item = query.data?.lotteryPeriodClose;
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={isMobile}
      title={t("snapshotDialog.title", { month })}
      actions={
        <Button variant="text" onClick={onClose}>
          {t("snapshotDialog.close")}
        </Button>
      }
    >
      {item !== undefined && (
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="textSecondary">
            {t("snapshotDialog.closedBy", {
              name: item.closedBy.name,
              at: formatTemporal(item.closedAt, { type: "datetime", timezone }),
            })}
          </Typography>
          {item.note != null && (
            <Typography variant="body2">{item.note}</Typography>
          )}
          <PeriodSnapshotList snapshot={item.snapshot} title={t("snapshot")} />
        </Stack>
      )}
    </Dialog>
  );
};
