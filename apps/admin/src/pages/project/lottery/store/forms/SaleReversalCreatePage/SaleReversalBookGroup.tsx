import { useTranslations } from "use-intl";

import { displayBookNo } from "@repo/domain/project/lottery";
import { useLotteryStoreBookCardQuery } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  TicketGrid,
  type TicketGridCell,
} from "@/components/project/lottery/TicketGrid/TicketGrid";
import type { TicketCellState } from "@/components/project/lottery/TicketGrid/ticket-cell-styles";
import { useSession } from "@/hooks/base/useSession";

import type { ReversalGroup } from "../sale-reversal-form";

/** 能選 = 本店已售、沒被單據鎖定(畫成「未售」那一格的樣式:白底可點)。 */
const SELECTABLE: readonly TicketCellState[] = ["unsold"];

/** 圖例:已售(可選)/ 不能選(未售、撤銷審核中…)/ 已選。 */
const LEGEND: readonly TicketCellState[] = ["unsold", "sold", "selected"];

export interface SaleReversalBookGroupProps {
  orgId: string;
  group: ReversalGroup;
  onChange: (ticketNos: string[]) => void;
  onRemove: () => void;
}

/**
 * 撤銷售出申請新增頁的一本(Figma ST-31b 90:4601):本的標題 + 張數格子(每本一組;規格 8.5 張數跨多本時依本分組)。
 * 只有本店已售、不在其他未結束撤銷單上(沒被鎖定)的張能選;格子資料沿用看板展開卡片的 `lotteryStoreBookCard`。
 */
export const SaleReversalBookGroup = ({
  orgId,
  group,
  onChange,
  onRemove,
}: SaleReversalBookGroupProps) => {
  const t = useTranslations("admin.lotteryStore.saleReversal");
  const { session } = useSession();
  const query = useLotteryStoreBookCardQuery(
    session.client,
    { orgId, bookId: group.bookId },
    { staleTime: 0 },
  );
  const tickets = query.data?.lotteryStoreBookCard.item.tickets ?? [];
  const cells: TicketGridCell[] = tickets.map((ticket) => ({
    ticketNo: ticket.ticketNo,
    state: ticket.status === "sold" && !ticket.locked ? "unsold" : "sold",
  }));
  return (
    <Card variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle2" component="h3" sx={{ flex: 1 }}>
            {t("bookHeader", {
              gameCode: group.gameCode,
              gameName: group.gameName,
              bookNo: displayBookNo(group.bookNo),
            })}
          </Typography>
          <Button variant="text" size="small" onClick={onRemove}>
            {t("removeBook")}
          </Button>
        </Stack>
        {query.isLoading ? (
          <CircularProgress aria-label={t("loading")} />
        ) : (
          <TicketGrid
            cells={cells}
            selectableStates={SELECTABLE}
            selected={group.ticketNos}
            onSelectedChange={onChange}
            legendItems={LEGEND}
            labels={{
              unsold: t("cellReversible"),
              sold: t("cellUnavailable"),
            }}
          />
        )}
      </Stack>
    </Card>
  );
};
