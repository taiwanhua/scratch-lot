import type { Theme } from "@mui/material/styles";

/** 七天等分的欄;`minmax(0, 1fr)` 讓長內容不撐破格寬(窄容器照樣七等分)。 */
export const WEEK_COLUMNS = "repeat(7, minmax(0, 1fr))";

/** 多選時每週左側勾選框那一欄的寬度(Figma BS-23 260:6356 的勾選欄)。 */
export const weekCheckboxColumnWidth = (theme: Theme) => theme.spacing(5);
