import type { ReactNode } from "react";

import { STORE_PERMISSIONS } from "@repo/domain/project/lottery";
import { useLotteryStoreRecentSalesQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Drawer } from "@repo/ui/drawer";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";

import { moneyText } from "../../store-text";
import { useSalesText } from "./useSalesText";

export interface RecentSalesDrawerProps {
  shiftId: string;
  cashPointName: string;
  onClose: () => void;
  /** 每列的 [撤銷](先開撤銷確認) */
  onUndo: (ticketId: string) => void;
}

/**
 * [最近售出](Figma ST-35b;規格 6.2、6.3):自己在這一班 30 分鐘內賣的張,每列 [撤銷];撤銷後清單不關,
 * 那一筆顯示「已撤銷」。電腦 / 平板右側抽屜(✕、點外面、Esc 關閉),手機底部面板(上方有拉桿)。
 */
export const RecentSalesDrawer = ({
  shiftId,
  cashPointName,
  onClose,
  onUndo,
}: RecentSalesDrawerProps) => {
  const { t, clock } = useSalesText();
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const isMobile = useBreakpointDown("sm");
  const rows =
    useLotteryStoreRecentSalesQuery(
      session.client,
      { shiftId },
      { staleTime: 0 },
    ).data?.lotteryStoreRecentSales.items ?? [];
  const canUndo = hasPermission(STORE_PERMISSIONS.undoSale);
  return (
    <Drawer
      open
      anchor={isMobile ? "bottom" : "right"}
      title={t("recentSales.title", { cashPoint: cashPointName })}
      closeLabel={t("recentSales.close")}
      onClose={onClose}
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t("recentSales.hint")}
        </Typography>
        {rows.length === 0 ? (
          <Typography color="text.secondary">
            {t("recentSales.empty")}
          </Typography>
        ) : (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
            {rows.map((row) => {
              let status: ReactNode = null;
              if (row.undone) {
                status = (
                  <Typography variant="caption" color="text.secondary">
                    {t("recentSales.undone")}
                  </Typography>
                );
              } else if (row.undoBlock == null && canUndo) {
                status = (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      onUndo(row.ticketId);
                    }}
                  >
                    {t("sale.undo")}
                  </Button>
                );
              } else if (row.undoBlock === "expired") {
                status = (
                  <Typography variant="caption" color="text.secondary">
                    {t("recentSales.expired")}
                  </Typography>
                );
              }
              return (
                <Stack
                  key={`${row.ticketId}-${row.soldAt}`}
                  component="li"
                  direction="row"
                  spacing={1.5}
                  sx={{
                    alignItems: "center",
                    py: 1,
                    borderBottom: 1,
                    borderColor: "divider",
                  }}
                >
                  <Typography variant="body2" sx={{ width: 48 }}>
                    {clock(row.soldAt)}
                  </Typography>
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {row.ticketKey}
                  </Typography>
                  <Typography variant="body2">
                    {moneyText(row.amount)}
                  </Typography>
                  <Box sx={{ minWidth: 72, textAlign: "right" }}>{status}</Box>
                </Stack>
              );
            })}
          </Box>
        )}
        <Alert severity="info">{t("recentSales.footer")}</Alert>
      </Stack>
    </Drawer>
  );
};
