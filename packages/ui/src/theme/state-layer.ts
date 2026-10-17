import type { CSSObject, Theme } from "@mui/material/styles";

/**
 * state layer 的色系。`grey` 給白底元件(bg/default、bg/paper):疊 `grey/500`,
 * 即主題的 `action.hover` / `action.selected`;其餘是有底色的元件(標籤、長條),疊自己的 main。
 */
export type StateLayerTone =
  "grey" | "primary" | "info" | "success" | "warning" | "error";

export interface StateLayerOptions {
  /** 色系;預設 `grey`(白底元件) */
  tone?: StateLayerTone;
  /** 已選取:常駐 selected 圖層 + 1px main 邊框 */
  selected?: boolean;
  /**
   * 已選取用的色系;預設同 `tone`。白底元件的選取要用主色時給 `primary`
   * (MUI 清單 / 表格列的選取做法:滑過仍是灰,選取疊主色,例 `MonthCalendar` 的已選日期)
   */
  selectedTone?: StateLayerTone;
}

/** 1px 內框:用 inset 陰影畫,不佔版面,選取 / 滑過時元素不會位移。 */
const ring = (color: string) => `inset 0 0 0 1px ${color}`;

/** 一層 state layer:同一色值的漸層當成疊在原底色上的半透明圖層(底色照舊)。 */
const layer = (color: string) => `linear-gradient(${color}, ${color})`;

/**
 * 可點元素的互動狀態(《底座規格》10.11;MUI outlined / text 按鈕的做法):
 * - 滑過:原底色上疊同色系 `main` × `action.hoverOpacity`(8%),邊框換成同色系 `main`;
 * - 已選取:疊 `main` × `action.selectedOpacity`(16%)+ 1px 同色系 `main` 邊框;
 * - 鍵盤焦點:`action.focus` 外框;
 * - 觸控裝置沒有滑過(只在 `hover: hover` 的裝置套滑過),按下時底色加深(疊 selected 圖層);
 * - 游標手指。停用(不能操作)的元素**不要**套這組:不變色、游標維持箭頭。
 *
 * 顏色一律取主題變數(`theme.vars`,深色模式跟著切),透明度用主題的 opacity(目前全站一套 8% / 16%,
 * 見 `create-theme.ts`),不另做顏色。
 * 本檔是 ui 內部用的(同 `sx.ts`),不從 `theme/index.ts` 匯出。
 */
export const stateLayerSx = (
  theme: Theme,
  {
    tone = "grey",
    selected = false,
    selectedTone = tone,
  }: StateLayerOptions = {},
): CSSObject => {
  const { palette } = theme.vars ?? theme;
  const mainOf = (t: StateLayerTone) =>
    t === "grey" ? palette.grey[500] : palette[t].main;
  const main = mainOf(tone);
  const selectedMain = mainOf(selectedTone);
  const hoverLayer = layer(theme.alpha(main, palette.action.hoverOpacity));
  const pressedLayer = layer(theme.alpha(main, palette.action.selectedOpacity));
  const selectedLayer = layer(
    theme.alpha(selectedMain, palette.action.selectedOpacity),
  );
  const resting = selected ? [selectedLayer] : [];
  return {
    cursor: "pointer",
    backgroundImage: resting.length > 0 ? resting.join(", ") : "none",
    boxShadow: selected ? ring(selectedMain) : "none",
    "@media (hover: hover)": {
      "&:hover": {
        backgroundImage: [hoverLayer, ...resting].join(", "),
        boxShadow: ring(selected ? selectedMain : main),
      },
    },
    "&:active": {
      backgroundImage: [pressedLayer, ...resting].join(", "),
    },
    "&:focus-visible": {
      outline: `2px solid ${palette.action.focus}`,
      outlineOffset: "-2px",
    },
  };
};
