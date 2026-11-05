import { useTranslations } from "use-intl";

import {
  type ScrapBlock,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Typography } from "@repo/ui/typography";

export interface SelectionBarProps {
  tickets: readonly { ticketNo: string }[];
  /**
   * [報廢](選到的全是未售,且有 `scrap`;null = 不顯示):`block` ≠ null 時停用並寫原因
   * (這本還沒拆 / 檯面上的張請先收回 / 被鎖定;張數店規格 7.8)
   */
  scrap: { block: ScrapBlock | null } | null;
  /** 顯示 [撤銷報廢](選到的全是報廢,且有 `scrap`) */
  canUndoScrap: boolean;
  /** 顯示 [尋回](選到的全是待查 / 遺失,且有 `recover`) */
  canRecover: boolean;
  onScrap: () => void;
  onUndoScrap: () => void;
  onRecover: () => void;
  onClear: () => void;
}

/** 報廢停用的原因 → 文字 key(`admin.lotteryInventory.book`)。 */
const SCRAP_BLOCK_KEYS: Record<ScrapBlock, string> = {
  book_unopened: "scrapBlocks.bookUnopened",
  not_in_stock: "scrapBlocks.notInStock",
  locked: "scrapBlocks.locked",
  not_unsold: "scrapBlocks.notUnsold",
};

/**
 * 選張後格子正上方的操作列(規格 7.3;Figma IN-03、IN-03-2a / 2b):「已選 3 張 #090–092」+ 依選到的狀態給的按鈕
 * (選到不同狀態只顯示共同可用的;[報廢] 不能按時寫原因)+ [取消選取]。沒有選張時不顯示。
 */
export const SelectionBar = ({
  tickets,
  scrap,
  canUndoScrap,
  canRecover,
  onScrap,
  onUndoScrap,
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
      {scrap === null ? null : (
        <>
          <Button
            variant="outlined"
            color="error"
            size="small"
            disabled={scrap.block !== null}
            onClick={onScrap}
          >
            {t("scrap")}
          </Button>
          <Typography variant="caption" color="textSecondary">
            {scrap.block === null
              ? t("scrapStockOnly")
              : t(SCRAP_BLOCK_KEYS[scrap.block])}
          </Typography>
        </>
      )}
      {canUndoScrap ? (
        <>
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={onUndoScrap}
          >
            {t("undoScrap")}
          </Button>
          <Typography variant="caption" color="textSecondary">
            {t("scrapStockOnly")}
          </Typography>
        </>
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
