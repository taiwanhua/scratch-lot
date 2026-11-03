import { useTranslations } from "use-intl";

import { displayBookNo } from "@repo/domain/project/lottery";
import { useLotteryStoreBookCardQuery } from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import {
  TicketGrid,
  type TicketGridCell,
} from "@/components/project/lottery/TicketGrid/TicketGrid";
import type { TicketCellState } from "@/components/project/lottery/TicketGrid/ticket-cell-styles";
import { useSession } from "@/hooks/base/useSession";

import type { ReversalGroup } from "../sale-reversal-form";

/** 能選 = 本店已售、張號確定、沒被單據鎖定(畫成「未售」那一格的樣式:白底可點)。 */
const SELECTABLE: readonly TicketCellState[] = ["unsold"];

/** 圖例:已售(可選)/ 不能選(未售、撤銷審核中…)/ 已售·未對號(張數店,虛線、不能點)/ 已選。 */
const legendOf = (hasUnmatched: boolean): readonly TicketCellState[] => [
  "unsold",
  "sold",
  ...(hasUnmatched ? (["unmatchedSold"] as const) : []),
  "selected",
];

/** 一格的樣子:確定張號的已售 → 可選;已售·未對號 → 虛線;其他 → 不能選。 */
const cellStateOf = (ticket: {
  status: string;
  locked: boolean;
  unmatched: boolean;
}): TicketGridCell["state"] => {
  if (ticket.status !== "sold" || ticket.locked) {
    return "sold";
  }
  return ticket.unmatched ? "unmatchedSold" : "unsold";
};

export interface SaleReversalBookGroupProps {
  orgId: string;
  group: ReversalGroup;
  onChange: (ticketNos: string[]) => void;
  onRemove: () => void;
  /** 移除一張送出時對號的張 */
  onRemoveMatch: (ticketNo: string) => void;
}

/**
 * 撤銷售出申請新增頁的一本(Figma ST-31b 90:4601、CS-14):本的標題 + 張數格子(每本一組;規格 8.5 張數跨多本時依本分組)。
 * 只有本店已售、張號確定(刷條碼賣出、對過號或補點確認過)、不在其他未結束撤銷單上的張能選;已售·未對號畫虛線、不能點
 * (張數店規格 13.2)。張數店刷到、不是確定張號的已售的張列在格子下方「已對號」(送出時先對號再鎖,7.3 第 3 點)。
 * 格子資料沿用看板展開卡片的 `lotteryStoreBookCard`。
 */
export const SaleReversalBookGroup = ({
  orgId,
  group,
  onChange,
  onRemove,
  onRemoveMatch,
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
    state: cellStateOf(ticket),
  }));
  const hasUnmatched = cells.some((cell) => cell.state === "unmatchedSold");
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
            legendItems={legendOf(hasUnmatched)}
            labels={{
              unsold: t("cellReversible"),
              sold: t("cellUnavailable"),
            }}
            {...(hasUnmatched && { legendNote: t("dashedNote") })}
          />
        )}
        {group.matchNos.map((ticketNo) => (
          <Stack
            key={ticketNo}
            direction="row"
            spacing={1}
            sx={{ alignItems: "center" }}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", flex: 1, flexWrap: "wrap" }}
            >
              <Typography variant="body2" color="textSecondary">
                {t("matchTicket", {
                  gameCode: group.gameCode,
                  bookNo: displayBookNo(group.bookNo),
                  ticketNo,
                })}
              </Typography>
              <Tag tone="success" label={t("matched")} />
            </Stack>
            <Button
              variant="text"
              size="small"
              onClick={() => {
                onRemoveMatch(ticketNo);
              }}
            >
              {t("remove")}
            </Button>
          </Stack>
        ))}
      </Stack>
    </Card>
  );
};
