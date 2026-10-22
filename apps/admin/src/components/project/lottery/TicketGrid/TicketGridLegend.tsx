import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { TICKET_CELL_SX, type TicketCellState } from "./ticket-cell-styles";
import { useTicketCellLabels } from "./useTicketCellLabels";

export interface TicketGridLegendProps {
  /** 要顯示的狀態(只打開畫面用得到的,依傳入順序)。 */
  items: readonly TicketCellState[];
  /** 覆寫的文字(例:盤點把「已選」寫成「在(已點)」);沒給的用預設文字。 */
  labels?: Partial<Record<TicketCellState, string>>;
}

/**
 * 張數格子的共用圖例(專案規格 7.5;Figma `Draft/TicketGridLegend` 174:264):放在格子正上方靠右、
 * 寬度跟格子一樣,窄螢幕自動換行。色塊就是格子的變體樣式,格子改色圖例跟著變。
 */
export const TicketGridLegend = ({ items, labels }: TicketGridLegendProps) => {
  const t = useTranslations("admin.lotteryInventory.ticketGrid");
  const labelOf = useTicketCellLabels(labels);
  return (
    <Stack
      component="ul"
      aria-label={t("legendAria")}
      direction="row"
      spacing={1.5}
      useFlexGap
      sx={{
        flexWrap: "wrap",
        justifyContent: "flex-end",
        alignItems: "center",
        m: 0,
        p: 0,
        listStyle: "none",
      }}
    >
      {items.map((state) => (
        <Stack
          key={state}
          component="li"
          direction="row"
          spacing={0.75}
          sx={{ alignItems: "center" }}
        >
          <Box
            aria-hidden
            data-state={state}
            sx={{
              width: (theme) => theme.spacing(2),
              height: (theme) => theme.spacing(2),
              borderRadius: 0.5,
              ...TICKET_CELL_SX[state],
            }}
          />
          <Typography variant="caption" color="textSecondary">
            {labelOf(state)}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
};
