import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";

import { type ReversalCountRow, newCountRowOf } from "../sale-reversal-form";
import { SaleReversalCountRow } from "./SaleReversalCountRow";

export interface SaleReversalCountRowsProps {
  /** 張數店與轉換中才顯示 */
  visible: boolean;
  orgId: string;
  rows: readonly ReversalCountRow[];
  cashPoints: readonly { id: string; name: string }[];
  localCashPointId: string | null;
  /** 送出前檢查沒過(沒選遊戲的列標紅) */
  error: boolean;
  newRowId: () => string;
  onChange: (rows: ReversalCountRow[]) => void;
}

/**
 * 撤銷售出申請的「依遊戲 + 張數」各列與 [+ 加一列:依遊戲 + 張數](張數店規格 7.3 第 3 點、13.2;Figma CS-14;
 * 只在張數店與轉換中顯示)。新的一列收銀點預設本機。
 */
export const SaleReversalCountRows = ({
  visible,
  orgId,
  rows,
  cashPoints,
  localCashPointId,
  error,
  newRowId,
  onChange,
}: SaleReversalCountRowsProps) => {
  const t = useTranslations("admin.lotteryStore.saleReversal");
  if (!visible) {
    return null;
  }
  const replace = (next: ReversalCountRow) => {
    onChange(rows.map((row) => (row.rowId === next.rowId ? next : row)));
  };
  return (
    <Stack spacing={2}>
      {rows.map((row) => (
        <SaleReversalCountRow
          key={row.rowId}
          orgId={orgId}
          row={row}
          cashPoints={cashPoints}
          localCashPointId={localCashPointId}
          error={error}
          onChange={replace}
          onRemove={() => {
            onChange(rows.filter((one) => one.rowId !== row.rowId));
          }}
        />
      ))}
      <Box>
        <Button
          variant="text"
          onClick={() => {
            onChange([
              ...rows,
              newCountRowOf(
                newRowId(),
                localCashPointId ?? cashPoints.at(0)?.id ?? "",
              ),
            ]);
          }}
        >
          {t("addCountRow")}
        </Button>
      </Box>
    </Stack>
  );
};
