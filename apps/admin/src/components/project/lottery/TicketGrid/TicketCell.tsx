import { Box } from "@repo/ui/box";
import { Tooltip } from "@repo/ui/tooltip";

import { FLASH_HIGHLIGHT_SX } from "@/lib/base/flash-highlight";

import { TICKET_CELL_SX, type TicketCellState } from "./ticket-cell-styles";

export interface TicketCellProps {
  /** 張號(3 位,例 "012")。 */
  ticketNo: string;
  /** 顯示的狀態(已選時呼叫端傳 `selected`)。 */
  state: TicketCellState;
  /** 這種狀態在這個畫面的文字(念給螢幕閱讀器;例「未售」「在(已點)」)。 */
  label: string;
  /** 能不能點(使用處依狀態決定)。 */
  selectable: boolean;
  /** 滑過 / 長按的提示(例:在別的收銀點的收銀點名稱)。 */
  tooltip?: string;
  /** 閃一下(刷到這一張;底座閃爍提示 `FLASH_HIGHLIGHT_SX`);值換了就再閃一次。不給 = 不閃。 */
  flashKey?: number;
  /** 點格子;`shiftKey` = 按著 Shift(連選)。 */
  onClick?: (shiftKey: boolean) => void;
}

/**
 * 張數格子的一格(專案規格 7.5;Figma `Draft/TicketCell` 64:132)。外觀由狀態決定
 * (`ticket-cell-styles.ts`),不能選的格子停用;提示在電腦滑過、手機長按時出現(`@repo/ui/tooltip`)。
 */
export const TicketCell = ({
  ticketNo,
  state,
  label,
  selectable,
  tooltip,
  flashKey,
  onClick,
}: TicketCellProps) => {
  // `Box` 的型別只認 div 的屬性;`<button>` 自己的 `type` / `disabled` 以展開傳入
  // (格子在表單裡不能是 submit 鈕)
  const buttonProps = { type: "button", disabled: !selectable } as const;
  const cell = (
    <Box
      key={flashKey}
      component="button"
      {...buttonProps}
      data-flash={flashKey === undefined ? undefined : "true"}
      data-state={state}
      aria-label={`#${ticketNo} ${label}`}
      aria-pressed={state === "selected"}
      onClick={(event) => {
        onClick?.(event.shiftKey);
      }}
      sx={{
        width: "100%",
        minWidth: 0,
        height: (theme) => theme.spacing(4),
        px: 0,
        borderRadius: 1,
        // 手機一列 10 格很窄,號碼縮一級才不會貼框(STYLE-03 斷點)
        typography: { xs: "caption", sm: "body2" },
        fontVariantNumeric: "tabular-nums",
        cursor: selectable ? "pointer" : "default",
        "&:focus-visible": {
          outline: 2,
          outlineColor: "primary.main",
          outlineOffset: 1,
        },
        ...TICKET_CELL_SX[state],
        ...(flashKey !== undefined && FLASH_HIGHLIGHT_SX),
      }}
    >
      {ticketNo}
    </Box>
  );
  return tooltip ? <Tooltip title={tooltip}>{cell}</Tooltip> : cell;
};
