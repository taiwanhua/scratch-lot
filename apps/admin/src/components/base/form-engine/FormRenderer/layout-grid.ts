import { spanFor } from "@repo/domain/form";

/**
 * 版面的 12 格制(Spec 6a §5 Layout):以 `@repo/ui/grid` 排(欄數 = `@repo/domain/form` 的 `LAYOUT_COLUMNS`),
 * 桌機用 `span`、平板 `span × 2` 封頂 12、手機一律 12(換算正本 `spanFor`),斷點用 theme 的 `xs` / `sm` / `md`。
 */

/** 分區容器的欄距 / 列距(theme spacing 倍數)。 */
export const SECTION_SPACING = 2;

/** 一格的 `Grid size`(手機 / 平板 / 桌機三段)。 */
export const cellSize = (span: number) => ({
  xs: spanFor(span, "mobile"),
  sm: spanFor(span, "tablet"),
  md: spanFor(span, "desktop"),
});
