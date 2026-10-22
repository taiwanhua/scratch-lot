import { useTranslations } from "use-intl";

import { formatTicketRanges } from "@repo/domain/project/lottery";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Typography } from "@repo/ui/typography";

export interface SelectionBarProps {
  tickets: readonly { ticketNo: string }[];
  /** 顯示 [報廢](選到的全是未售,且有 `scrap`) */
  canScrap: boolean;
  /** 顯示 [尋回](選到的全是待查 / 遺失,且有 `recover`) */
  canRecover: boolean;
  onScrap: () => void;
  onRecover: () => void;
  onClear: () => void;
}

/**
 * 選張後格子正上方的操作列(規格 7.3;Figma IN-03):「已選 3 張 #090–092」+ 依選到的狀態給的按鈕
 * (選到不同狀態只顯示共同可用的)+ [取消選取]。沒有選張時不顯示。
 */
export const SelectionBar = ({
  tickets,
  canScrap,
  canRecover,
  onScrap,
  onRecover,
  onClear,
}: SelectionBarProps) => {
  const t = useTranslations("admin.lotteryInventory.book");
  if (tickets.length === 0) {
    return null;
  }
  return (
    <Box
      sx={{
        mt: 1.5,
        px: 2,
        py: 1,
        borderRadius: 1,
        bgcolor: "action.hover",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 1,
      }}
    >
      <Typography variant="body2" color="textPrimary" sx={{ flex: 1 }}>
        {t("selected", {
          count: tickets.length,
          ranges: formatTicketRanges(tickets.map((ticket) => ticket.ticketNo)),
        })}
      </Typography>
      {canScrap ? (
        <Button variant="outlined" color="error" size="small" onClick={onScrap}>
          {t("scrap")}
        </Button>
      ) : null}
      {canRecover ? (
        <Button variant="outlined" size="small" onClick={onRecover}>
          {t("recover")}
        </Button>
      ) : null}
      <Button variant="text" size="small" onClick={onClear}>
        {t("clearSelection")}
      </Button>
    </Box>
  );
};
