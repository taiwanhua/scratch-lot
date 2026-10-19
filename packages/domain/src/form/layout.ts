import type { Layout, LayoutSection } from "./types";

/** 版面換算:12 格制,桌機用 `span`、平板 `span × 2` 封頂 12、手機一律 12。 */
export const LAYOUT_COLUMNS = 12;

export const LAYOUT_BREAKPOINTS = ["desktop", "tablet", "mobile"] as const;

export type LayoutBreakpoint = (typeof LAYOUT_BREAKPOINTS)[number];

export function spanFor(span: number, breakpoint: LayoutBreakpoint): number {
  switch (breakpoint) {
    case "desktop": {
      return Math.min(span, LAYOUT_COLUMNS);
    }
    case "tablet": {
      return Math.min(span * 2, LAYOUT_COLUMNS);
    }
    case "mobile": {
      return LAYOUT_COLUMNS;
    }
  }
}

/** 整份版面換算到某斷點(結構不變,只換每格的 `span`)。 */
export function resolveLayout(
  layout: Layout,
  breakpoint: LayoutBreakpoint,
): Layout {
  return {
    sections: layout.sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) => ({
        cols: row.cols.map((col) => ({
          ...col,
          span: spanFor(col.span, breakpoint),
        })),
      })),
    })),
  };
}

/** 版面裡出現的欄位 key(依出現順序,重複的照列)。 */
export function layoutFieldKeys(layout: Layout): string[] {
  return layout.sections.flatMap((section) =>
    section.rows.flatMap((row) => row.cols.map((col) => col.fieldKey)),
  );
}

/** 分區的收合設定(補上預設值)。 */
export interface SectionCollapse {
  collapsible: boolean;
  /** 不可收合時一律 false */
  defaultCollapsed: boolean;
  /** 不可收合時一律空陣列 */
  summaryFieldKeys: string[];
}

/**
 * 分區的收合設定:舊定義沒有這三欄 → 不可收合、一律展開;`defaultCollapsed` / `summaryFieldKeys` 只在 `collapsible` 時生效。
 * 執行期(`FormRenderer`)與設計器都從這裡讀,不各自補預設。
 */
export function sectionCollapseOf(section: LayoutSection): SectionCollapse {
  const collapsible = section.collapsible === true;
  return {
    collapsible,
    defaultCollapsed: collapsible && section.defaultCollapsed === true,
    summaryFieldKeys: collapsible ? (section.summaryFieldKeys ?? []) : [],
  };
}
