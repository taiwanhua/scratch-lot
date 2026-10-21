import type { BoxProps } from "@repo/ui/box";

/**
 * 張數格子的九種狀態(專案規格 7.5 的樣式表;Figma `Draft/TicketCell` 64:132 的九個變體)。
 * **顏色和狀態一對一固定**,每種狀態的文字、可不可以選、圖例要顯示哪幾項由使用處決定。
 *
 * | 狀態             | 規格名稱          | 樣式                                         |
 * | ---------------- | ----------------- | -------------------------------------------- |
 * | `unsold`         | 未售 / 未分配     | 白底、分隔線色細框                           |
 * | `selected`       | 已選              | 主色底、字用主色的對比色                     |
 * | `sold`           | 已售 / 不能選     | 停用底、停用字色(被其他單據鎖定也用這個)     |
 * | `soldThisShift`  | 本班售出          | 停用底 + 主色框                              |
 * | `otherCashPoint` | 在別的收銀點      | 淺灰底 + 細斜線底紋、次要文字色虛線框        |
 * | `assigned`       | 已分配            | 主色淺底、次要文字色號碼                     |
 * | `skipped`        | 跳號              | 停用底 + 錯誤色虛線框                        |
 * | `scrapped`       | 報廢              | 停用底 + 錯誤色細框                          |
 * | `lost`           | 待查 / 遺失       | 停用底 + 警告色框                            |
 */
export const TICKET_CELL_STATES = [
  "unsold",
  "selected",
  "sold",
  "soldThisShift",
  "otherCashPoint",
  "assigned",
  "skipped",
  "scrapped",
  "lost",
] as const;

export type TicketCellState = (typeof TICKET_CELL_STATES)[number];

/** 單一層的樣式物件(不含陣列與函式分支,才能和格子的幾何合併)。 */
export type TicketCellSx = Exclude<
  NonNullable<BoxProps["sx"]>,
  readonly unknown[] | ((...args: never[]) => unknown) | boolean
>;

/** 「在別的收銀點」的斜線底紋線距(一條線 + 一段空白,px)。設計值,只有這個變體用到(STYLE-06)。 */
const HATCH_STEP = 5;

const DISABLED: TicketCellSx = {
  bgcolor: "action.disabledBackground",
  color: "text.disabled",
};

/** 每種狀態的外觀(格子與圖例色塊共用,格子改色圖例跟著變)。 */
export const TICKET_CELL_SX: Record<TicketCellState, TicketCellSx> = {
  unsold: {
    bgcolor: "background.paper",
    color: "text.primary",
    border: 1,
    borderColor: "divider",
  },
  selected: {
    bgcolor: "primary.main",
    color: "primary.contrastText",
    border: 1,
    borderColor: "primary.main",
  },
  sold: { ...DISABLED, border: 1, borderColor: "transparent" },
  soldThisShift: { ...DISABLED, border: 2, borderColor: "primary.main" },
  otherCashPoint: {
    bgcolor: "grey.100",
    color: "text.secondary",
    border: 1,
    borderStyle: "dashed",
    borderColor: "text.secondary",
    backgroundImage: (theme) =>
      `repeating-linear-gradient(135deg, ${theme.palette.grey[300]} 0 1px, transparent 1px ${String(HATCH_STEP)}px)`,
  },
  assigned: {
    bgcolor: "primary.lighter",
    color: "text.secondary",
    border: 1,
    borderColor: "transparent",
  },
  skipped: {
    ...DISABLED,
    border: 2,
    borderStyle: "dashed",
    borderColor: "error.main",
  },
  scrapped: { ...DISABLED, border: 1, borderColor: "error.main" },
  lost: { ...DISABLED, border: 2, borderColor: "warning.main" },
};
