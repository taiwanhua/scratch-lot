import { displayBookNo } from "@repo/domain/project/lottery";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { moneyText } from "../../store-text";
import { TICKET_STATUS_KEYS } from "./sales-text";
import { type ScanItem, usePlaceText } from "./scan-place";
import { useSalesText } from "./useSalesText";

/**
 * 刷到的刮刮樂(ST-05 / ST-06 對話框上方的灰底區塊):遊戲、面額、本號 · 張號 · 位置 · 狀態。
 */
export const ScanTicketSummary = ({ item }: { item: ScanItem }) => {
  const { t } = useSalesText();
  const placeOf = usePlaceText();
  const statusKey = TICKET_STATUS_KEYS[item.status];
  return (
    <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5 }}>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "baseline" }}
      >
        <Typography variant="subtitle1" color="textPrimary">
          {item.gameCode} {item.gameName}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {t("card.price", { price: moneyText(item.unitPrice) })}
        </Typography>
      </Stack>
      <Typography variant="body2" color="textSecondary">
        {[
          t("scan.bookTicket", {
            bookNo: displayBookNo(item.bookNo),
            ticketNo: item.ticketNo,
          }),
          placeOf(item),
          statusKey === undefined ? null : t(statusKey),
        ]
          .filter((part) => part !== null)
          .join(" · ")}
      </Typography>
    </Box>
  );
};
