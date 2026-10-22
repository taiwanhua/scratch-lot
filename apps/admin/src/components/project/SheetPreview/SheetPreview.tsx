import type { ComponentType } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tabs } from "@repo/ui/tabs";
import { Typography } from "@repo/ui/typography";

import type { SheetCell, SheetData } from "@/lib/project/reports/excel";

export interface SheetPreviewProps {
  /** 工作表(與 Excel 同一份,`lib/project/reports/excel.ts`) */
  sheets: readonly SheetData[];
  /** 目前顯示第幾個工作表(0 起);超出範圍時顯示第一個 */
  value: number;
  onChange: (index: number) => void;
  /** 工作表的畫法(例:區塊卡片);不給 = 表格。頁籤、說明照舊 */
  Body?: ComponentType<{ sheet: SheetData }>;
}

type SheetRow = Readonly<Record<string, SheetCell>> & { rowIndex: number };

const TAB_PANEL_ID = "sheet-preview-panel";

const cellText = (value: SheetCell | undefined): string => {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? value.toLocaleString() : value;
};

/**
 * 預覽(專案規格 11.4、18.4「預覽」;Figma RE-02 `94:411`):工作表 → 表格的通用元件。
 * 上方一列頁籤切工作表(輸出報表傳進來時第一個就是「全部分店合計」,所以預設顯示合計),
 * 表頭說明(`notes`)排在表格上方,欄位與列照 Excel 的順序。只有一個工作表時不顯示頁籤。
 */
export const SheetPreview = ({
  sheets,
  value,
  onChange,
  Body,
}: SheetPreviewProps) => {
  const t = useTranslations("admin.lotteryReports.sheetPreview");
  const index = value >= 0 && value < sheets.length ? value : 0;
  const sheet = sheets.at(index);
  if (sheet === undefined) return null;

  const columns: TableColumn<SheetRow>[] = sheet.columns.map((column) => ({
    key: column.key,
    header: column.header,
    align: column.align,
    render: (row) => cellText(row[column.key]),
  }));
  const rows: SheetRow[] = sheet.rows.map((row, rowIndex) => ({
    ...row,
    rowIndex,
  }));

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      {sheets.length > 1 && (
        <Tabs
          aria-label={t("tabsAria")}
          scrollable
          value={String(index)}
          onChange={(next) => {
            onChange(Number(next));
          }}
          items={sheets.map((item, itemIndex) => ({
            value: String(itemIndex),
            label: item.name,
            "aria-controls": TAB_PANEL_ID,
          }))}
        />
      )}
      <Box
        id={TAB_PANEL_ID}
        role={sheets.length > 1 ? "tabpanel" : undefined}
        aria-label={sheet.name}
        sx={{ minWidth: 0 }}
      >
        <Stack spacing={1.5}>
          {(sheet.notes ?? []).map((note) => (
            <Typography key={note} variant="body2" color="textSecondary">
              {note}
            </Typography>
          ))}
          {Body === undefined ? (
            <Table
              aria-label={sheet.name}
              columns={columns}
              rows={rows}
              getRowKey={(row) => String(row.rowIndex)}
              emptyMessage={t("empty")}
              size="small"
            />
          ) : (
            <Body sheet={sheet} />
          )}
        </Stack>
      </Box>
    </Stack>
  );
};
