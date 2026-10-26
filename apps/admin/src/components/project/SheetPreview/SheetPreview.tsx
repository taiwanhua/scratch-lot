import type { ComponentType } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tabs } from "@repo/ui/tabs";
import { Typography } from "@repo/ui/typography";

import {
  type SheetColumn,
  type SheetData,
  type SheetRow,
  type SheetSection,
  isPercentRow,
  isTotalRow,
  sheetCellText,
} from "@/lib/project/reports/excel";

export interface SheetPreviewProps {
  /** 工作表(與 Excel 同一份,`lib/project/reports/excel.ts`) */
  sheets: readonly SheetData[];
  /** 目前顯示第幾個工作表(0 起);超出範圍時顯示第一個 */
  value: number;
  onChange: (index: number) => void;
  /** 工作表的畫法(例:區塊卡片);不給 = 表格(分段表格逐段一張表)。頁籤、說明照舊 */
  Body?: ComponentType<{ sheet: SheetData }>;
}

type IndexedRow = SheetRow & { rowIndex: number };

const TAB_PANEL_ID = "sheet-preview-panel";

/** 一格:負數紅字(同 Excel `[Red]`)、合計列粗體。 */
const Cell = ({ row, column }: { row: SheetRow; column: SheetColumn }) => {
  const value = row[column.key];
  return (
    <Typography
      variant="body2"
      component="span"
      color={typeof value === "number" && value < 0 ? "error" : "textPrimary"}
      sx={{ fontWeight: isTotalRow(row) ? 600 : undefined }}
    >
      {sheetCellText(value, isPercentRow(row))}
    </Typography>
  );
};

const tableColumnsOf = (
  columns: readonly SheetColumn[],
): TableColumn<IndexedRow>[] =>
  columns.map((column) => ({
    key: column.key,
    header: column.header,
    align: column.align,
    render: (row) => <Cell row={row} column={column} />,
  }));

/** 手機:每列一張卡片(第一欄當標題,其他有值的欄「表頭 值」一行一個)。 */
const RowCards = ({ section }: { section: SheetSection }) => {
  const first = section.columns.at(0);
  const rest = section.columns.slice(1);
  return (
    <Stack spacing={1}>
      {section.rows.map((row, rowIndex) => (
        <Card
          // 同一段的第一欄可能重複(例:同一帳戶多種類型)
          key={`${sheetCellText(first === undefined ? null : row[first.key])}-${String(rowIndex)}`}
          variant="outlined"
          sx={{ p: 1.5 }}
        >
          {first !== undefined && (
            <Typography
              variant="body2"
              sx={{ fontWeight: isTotalRow(row) ? 600 : 500 }}
            >
              {sheetCellText(row[first.key])}
            </Typography>
          )}
          {rest
            .filter((column) => sheetCellText(row[column.key]) !== "")
            .map((column) => (
              <Stack
                key={column.key}
                direction="row"
                spacing={1}
                sx={{ justifyContent: "space-between", alignItems: "baseline" }}
              >
                <Typography variant="caption" color="textSecondary">
                  {column.header}
                </Typography>
                <Cell row={row} column={column} />
              </Stack>
            ))}
        </Card>
      ))}
    </Stack>
  );
};

/** 分段表格的一段:標題、一句說明、表格(手機改每列一張卡片)、補充說明。 */
const SectionView = ({
  section,
  isCompact,
  emptyMessage,
}: {
  section: SheetSection;
  isCompact: boolean;
  emptyMessage: string;
}) => (
  <Stack component="section" aria-label={section.title} spacing={1}>
    <Box>
      <Typography variant="subtitle2" component="h3">
        {section.title}
      </Typography>
      {section.description !== undefined && (
        <Typography variant="caption" color="textSecondary">
          {section.description}
        </Typography>
      )}
    </Box>
    {isCompact ? (
      <RowCards section={section} />
    ) : (
      <Table
        aria-label={section.title}
        columns={tableColumnsOf(section.columns)}
        rows={section.rows.map((row, rowIndex) => ({ ...row, rowIndex }))}
        getRowKey={(row) => String(row.rowIndex)}
        emptyMessage={emptyMessage}
        size="small"
      />
    )}
    {(section.footnotes ?? []).map((footnote) => (
      <Typography key={footnote} variant="caption" color="textSecondary">
        {footnote}
      </Typography>
    ))}
  </Stack>
);

/**
 * 預覽(專案規格 11.4、18.4「預覽」;Figma RE-02 `94:411`):工作表 → 表格的通用元件。
 * 上方一列頁籤切工作表(輸出報表傳進來時第一個就是「全部分店合計」,所以預設顯示合計),
 * 表頭說明(`notes`)排在表格上方,欄位與列照 Excel 的順序。只有一個工作表時不顯示頁籤。
 * 分段表格(`sections`)逐段一張小表;手機(< sm)每列一張卡片。負數紅字、合計列粗體,與 Excel 相同。
 */
export const SheetPreview = ({
  sheets,
  value,
  onChange,
  Body,
}: SheetPreviewProps) => {
  const t = useTranslations("admin.lotteryReports.sheetPreview");
  const isCompact = useBreakpointDown("sm");
  const index = value >= 0 && value < sheets.length ? value : 0;
  const sheet = sheets.at(index);
  if (sheet === undefined) return null;

  let body = (
    <Table
      aria-label={sheet.name}
      columns={tableColumnsOf(sheet.columns)}
      rows={sheet.rows.map((row, rowIndex) => ({ ...row, rowIndex }))}
      getRowKey={(row) => String(row.rowIndex)}
      emptyMessage={t("empty")}
      size="small"
    />
  );
  if (Body !== undefined) {
    body = <Body sheet={sheet} />;
  } else if (sheet.sections !== undefined) {
    body = (
      <Stack spacing={3}>
        {sheet.sections.map((section, sectionIndex) => (
          <SectionView
            // 段標題可能重複
            key={`${section.title}-${String(sectionIndex)}`}
            section={section}
            isCompact={isCompact}
            emptyMessage={t("empty")}
          />
        ))}
      </Stack>
    );
  }

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
          {body}
        </Stack>
      </Box>
    </Stack>
  );
};
