import { useTranslations } from "use-intl";

import { useLotteryRecentRedemptionsQuery } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Drawer } from "@repo/ui/drawer";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { moneyText } from "../store-text";
import {
  type RedemptionRow,
  ticketShortOf,
  timeOnly,
} from "./redemption-shared";

export interface RecentRedemptionsDrawerProps {
  shiftId: string;
  cashPointName: string;
  onClose: () => void;
  /** 每列的 [撤銷](只有能撤銷的列有) */
  onRevoke: (row: RedemptionRow) => void;
  /** 點列的其他地方:兌獎紀錄詳情 */
  onOpen: (row: RedemptionRow) => void;
}

/**
 * [最近兌獎](規格 6.2、6.5;Figma ST-38b):自己在這一班登記的兌獎(含已撤銷,標「已撤銷」);
 * 電腦 / 平板右側抽屜、手機底部面板。每列 [撤銷] 開確認視窗,撤銷後清單不關、那一筆改「已撤銷」;
 * 點列的其他地方開兌獎紀錄詳情。只在按標題列 [最近兌獎] 時打開,兌獎後不自動打開。
 */
export const RecentRedemptionsDrawer = ({
  shiftId,
  cashPointName,
  onClose,
  onRevoke,
  onOpen,
}: RecentRedemptionsDrawerProps) => {
  const t = useTranslations("admin.lotteryStore.redemption");
  const { session } = useSession();
  const temporal = useTemporalText();
  const isMobile = useBreakpointDown("sm");
  const query = useLotteryRecentRedemptionsQuery(session.client, { shiftId });
  const rows = query.data?.lotteryRecentRedemptions ?? [];

  const columns: TableColumn<RedemptionRow>[] = [
    {
      key: "time",
      header: t("columns.time"),
      render: (row) => timeOnly(temporal(row.redeemedAt, "monthDayTime")),
    },
    {
      key: "ticket",
      header: t("columns.ticket"),
      render: (row) => ticketShortOf(row),
    },
    {
      key: "prize",
      header: t("columns.prize"),
      align: "right",
      render: (row) => moneyText(row.prizeAmount),
    },
    {
      key: "action",
      header: "",
      render: (row) => {
        if (row.status === "revoked") {
          return (
            <Typography variant="body2" color="text.secondary">
              {t("status.revoked")}
            </Typography>
          );
        }
        return row.revokeMode == null ? null : (
          <Button
            size="small"
            variant="outlined"
            disabled={row.revokeBlockedBySent}
            onClick={(event) => {
              event.stopPropagation();
              onRevoke(row);
            }}
          >
            {t("undo")}
          </Button>
        );
      },
    },
  ];

  return (
    <Drawer
      open
      anchor={isMobile ? "bottom" : "right"}
      title={t("recentTitle", { name: cashPointName })}
      closeLabel={t("close")}
      onClose={onClose}
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t("recentHint")}
        </Typography>
        <Table
          aria-label={t("recentTitle", { name: cashPointName })}
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          isLoading={query.isLoading}
          emptyMessage={t("recentEmpty")}
          onRowClick={onOpen}
          size="small"
        />
      </Stack>
    </Drawer>
  );
};
