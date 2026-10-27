import { useTranslations } from "use-intl";

import type { TicketCellState } from "./ticket-cell-styles";

/** 每種狀態的文字:使用處覆寫的優先,其餘用預設文字(`lotteryInventory.ticketGrid.states`)。 */
export const useTicketCellLabels = (
  labels: Partial<Record<TicketCellState, string>> | undefined,
): ((state: TicketCellState) => string) => {
  const t = useTranslations("admin.lotteryInventory.ticketGrid.states");
  return (state) => labels?.[state] ?? t(state);
};
