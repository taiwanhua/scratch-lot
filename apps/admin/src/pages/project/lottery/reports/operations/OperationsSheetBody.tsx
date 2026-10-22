import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { SheetCell } from "@/lib/project/reports/excel";
import type { ReportSheetBodyProps } from "@/lib/project/reports/report-registry";

const numberText = (value: SheetCell | undefined): string | null =>
  typeof value === "number" ? value.toLocaleString() : null;

/** 一列的值:「210 張 · 42,000」+ 說明(與 Excel 同一份資料,只是排成一句)。 */
const valueText = (row: Readonly<Record<string, SheetCell>>): string => {
  const count = numberText(row.count);
  const unit = typeof row.unit === "string" ? row.unit : "";
  let countText: string | null = null;
  if (count !== null) {
    countText = unit === "" ? count : `${count} ${unit}`;
  }
  const parts = [
    countText,
    numberText(row.amount),
    typeof row.note === "string" && row.note !== "" ? row.note : null,
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
};

/**
 * 營運報表的預覽(Figma RE-02 `94:411`、RE-04 `129:1186` / `143:36149` / `143:36385`):同一個工作表的列
 * 依「區塊」分組排成卡片(電腦 4 欄、平板 2 欄、手機 1 欄);依遊戲展開那一塊佔整列。Excel 照樣是表格。
 */
export const OperationsSheetBody = ({ sheet }: ReportSheetBodyProps) => {
  const blocks = new Map<string, Readonly<Record<string, SheetCell>>[]>();
  for (const row of sheet.rows) {
    const block = typeof row.block === "string" ? row.block : "";
    blocks.set(block, [...(blocks.get(block) ?? []), row]);
  }
  const entries = [...blocks.entries()];
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: {
          xs: "minmax(0, 1fr)",
          sm: "repeat(2, minmax(0, 1fr))",
          lg: "repeat(4, minmax(0, 1fr))",
        },
        alignItems: "start",
      }}
    >
      {entries.map(([block, rows]) => (
        <Card
          key={block}
          component="section"
          aria-label={block}
          variant="outlined"
          sx={{
            p: 2,
            minWidth: 0,
            // 依遊戲展開那一塊(列上標了 `wide`)佔整列
            gridColumn: rows.some((row) => row.wide === 1)
              ? "1 / -1"
              : undefined,
          }}
        >
          <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
            {block}
          </Typography>
          <Stack spacing={0.75}>
            {rows.map((row, rowIndex) => (
              <Stack
                // 同一區塊的項目名稱可能重複(例:兩個帳戶)
                key={`${String(row.item)}-${String(rowIndex)}`}
                direction="row"
                spacing={1}
                sx={{ justifyContent: "space-between", alignItems: "baseline" }}
              >
                <Typography variant="body2" color="textSecondary">
                  {row.item}
                </Typography>
                <Typography variant="body2" sx={{ textAlign: "right" }}>
                  {valueText(row)}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Card>
      ))}
    </Box>
  );
};
