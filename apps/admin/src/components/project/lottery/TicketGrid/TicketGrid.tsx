import { type ReactNode, useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { formatTicketRanges } from "@repo/domain/project/lottery";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { clickTicket } from "@/lib/project/lottery/ticket-selection";

import { TicketCell } from "./TicketCell";
import { TicketGridLegend } from "./TicketGridLegend";
import { TicketQuickSelect } from "./TicketQuickSelect";
import type { TicketCellState } from "./ticket-cell-styles";
import { useTicketCellLabels } from "./useTicketCellLabels";

/** 一格的資料:張號、這張在這個畫面的狀態(已選由 `selected` 決定,不放這裡)、提示。 */
export interface TicketGridCell {
  ticketNo: string;
  state: Exclude<TicketCellState, "selected">;
  /** 滑過 / 長按的提示(例:在別的收銀點的收銀點名稱)。 */
  tooltip?: string;
}

export interface TicketGridProps {
  /** 依張號順序的格子(每列 10 格)。 */
  cells: readonly TicketGridCell[];
  /** 哪些狀態能選(例:看板展開卡片 = 未售、本班售出;本的詳情頁 = 未售、待查·遺失)。 */
  selectableStates: readonly TicketCellState[];
  /** 已選的張號(受控)。 */
  selected: readonly string[];
  onSelectedChange: (selected: string[]) => void;
  /** 圖例要顯示的狀態(只放畫面用得到的)。 */
  legendItems: readonly TicketCellState[];
  /** 覆寫狀態文字(格子的念法與圖例共用;例 `{ selected: "在(已點)" }`)。 */
  labels?: Partial<Record<TicketCellState, string>>;
  /** 顯示「連號快選 從 [ ] 到 [ ]」;預設顯示。 */
  quickSelect?: boolean;
  /** 已選上限(例:拆本標跳號點滿 N 張);不給 = 不限。 */
  maxSelected?: number;
  /**
   * 格子下方的已選說明;不給 = 「已選 #012–016、#020(6 張)· Shift 可連選」,
   * `false` = 不顯示(使用處在操作列另外寫,例:「已選 2 / 2:#037、#064」)。
   */
  summary?: ReactNode;
  /**
   * 讓某一格閃一下(例:看板展開卡片時刷到這一張);`nonce` 每次刷到都換,同一張再刷也會再閃。
   */
  flash?: { ticketNo: string; nonce: number };
}

/**
 * 張數格子(專案規格 7.5;Figma `Draft/TicketGrid` 64:133):調貨選張、拆本、更正跳號、盤點、本的詳情頁、
 * 看板展開卡片、撤銷售出申請共用。每列 10 格;Shift 連選;連號快選;不連號以區段顯示。
 * 圖例在格子正上方靠右(`TicketGridLegend`)。狀態與顏色固定,文字、可選狀態與圖例項目由使用處傳入。
 */
export const TicketGrid = ({
  cells,
  selectableStates,
  selected,
  onSelectedChange,
  legendItems,
  labels,
  quickSelect = true,
  maxSelected,
  summary,
  flash,
}: TicketGridProps) => {
  const t = useTranslations("admin.lotteryInventory.ticketGrid");
  const labelOf = useTicketCellLabels(labels);
  const [anchor, setAnchor] = useState<string | null>(null);
  const selection = useMemo(() => {
    const allowed = new Set(selectableStates);
    return {
      order: cells.map((cell) => cell.ticketNo),
      selectable: new Set(
        cells
          .filter((cell) => allowed.has(cell.state))
          .map((cell) => cell.ticketNo),
      ),
      selected,
      max: maxSelected,
    };
  }, [cells, selectableStates, selected, maxSelected]);
  const selectedSet = new Set(selected);

  const defaultSummary =
    selected.length === 0
      ? t("shiftHint")
      : `${t("selectedSummary", {
          ranges: formatTicketRanges(selected),
          count: selected.length,
        })}${t("summarySeparator")}${t("shiftHint")}`;

  return (
    <Stack spacing={1.5}>
      {quickSelect ? (
        <TicketQuickSelect
          selection={selection}
          onSelectedChange={onSelectedChange}
        />
      ) : null}
      <TicketGridLegend items={legendItems} labels={labels} />
      <Box
        role="group"
        aria-label={t("gridAria")}
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(10, minmax(0, 1fr))",
          gap: { xs: 0.5, sm: 0.75 },
        }}
      >
        {cells.map((cell) => {
          const isSelected = selectedSet.has(cell.ticketNo);
          const state = isSelected ? "selected" : cell.state;
          return (
            <TicketCell
              key={cell.ticketNo}
              ticketNo={cell.ticketNo}
              state={state}
              label={labelOf(state)}
              selectable={selection.selectable.has(cell.ticketNo)}
              tooltip={cell.tooltip}
              {...(flash?.ticketNo === cell.ticketNo && {
                flashKey: flash.nonce,
              })}
              onClick={(shiftKey) => {
                onSelectedChange(
                  clickTicket(selection, cell.ticketNo, shiftKey, anchor),
                );
                setAnchor(cell.ticketNo);
              }}
            />
          );
        })}
      </Box>
      {summary === false ? null : (
        <Typography variant="body2" color="textSecondary">
          {summary ?? defaultSummary}
        </Typography>
      )}
    </Stack>
  );
};
