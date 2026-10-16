import { type Theme, createTheme } from "@mui/material/styles";

import type { Brand } from "./brand";
import {
  type CustomShadows,
  buildShadows,
  createCustomShadows,
  fontFamily,
  grey,
  radius,
  statusPalettes,
} from "./tokens";

declare module "@mui/material/styles" {
  interface Theme {
    customShadows: CustomShadows;
  }
  interface ThemeOptions {
    customShadows?: CustomShadows;
  }
  interface PaletteColor {
    lighter: string;
    darker: string;
  }
  interface SimplePaletteColorOptions {
    lighter?: string;
    darker?: string;
  }
}

export interface CreateAppThemeOptions {
  /**
   * CSS 變數前綴。預設 "mui"。
   * 需要在同一頁面掛第二份 theme 時(如 Palette Lab)換一個前綴避免衝突。
   */
  cssVarPrefix?: string;
}

/** grey[500] 的 rgb 通道,action 狀態透明度的基底(Minimal 慣用) */
const GREY_500_CHANNELS = "147, 158, 169";

const action = {
  hover: `rgba(${GREY_500_CHANNELS}, 0.08)`,
  selected: `rgba(${GREY_500_CHANNELS}, 0.16)`,
  focus: `rgba(${GREY_500_CHANNELS}, 0.24)`,
  disabled: `rgba(${GREY_500_CHANNELS}, 0.80)`,
  disabledBackground: `rgba(${GREY_500_CHANNELS}, 0.24)`,
} as const;

/**
 * 由品牌設定產生 MUI theme(第二層:語意角色)。
 * - cssVariables 模式:切換品牌/深淺色不需重新 render,並與 Figma variables 一對一對應
 * - light / dark 兩組 colorSchemes 從第一天就建模
 * - 陰影、狀態色、字級全部 token 化 — 元件與 apps 零字面值
 */
export const createAppTheme = (
  brand: Brand,
  options: CreateAppThemeOptions = {},
): Theme => {
  const { cssVarPrefix = "mui" } = options;

  const primary = { ...brand.primary };
  const { info, success, warning, error } = statusPalettes;
  const statusColors = { info, success, warning, error };
  const customShadows = createCustomShadows(brand.primary.main);

  return createTheme({
    cssVariables: {
      cssVarPrefix,
      colorSchemeSelector: "class",
    },
    colorSchemes: {
      light: {
        palette: {
          primary,
          ...statusColors,
          grey,
          background: { default: grey[100], paper: "#FFFFFF" },
          text: {
            primary: grey[800],
            secondary: grey[600],
            disabled: grey[500],
          },
          divider: `rgba(${GREY_500_CHANNELS}, 0.24)`,
          action,
        },
      },
      dark: {
        palette: {
          primary,
          ...statusColors,
          grey,
          background: { default: grey[900], paper: grey[800] },
          text: {
            primary: "#F7F9FA",
            secondary: grey[400],
            disabled: grey[600],
          },
          divider: `rgba(${GREY_500_CHANNELS}, 0.20)`,
          action,
        },
      },
    },
    typography: {
      fontFamily,
      h1: { fontWeight: 800, fontSize: "2.5rem", lineHeight: 1.25 },
      h2: { fontWeight: 800, fontSize: "2rem", lineHeight: 1.33 },
      h3: { fontWeight: 700, fontSize: "1.625rem", lineHeight: 1.38 },
      h4: { fontWeight: 700, fontSize: "1.375rem", lineHeight: 1.45 },
      h5: { fontWeight: 700, fontSize: "1.125rem", lineHeight: 1.5 },
      h6: { fontWeight: 600, fontSize: "1.0625rem", lineHeight: 1.55 },
      subtitle1: { fontWeight: 600, fontSize: "1rem", lineHeight: 1.5 },
      subtitle2: { fontWeight: 600, fontSize: "0.875rem", lineHeight: 1.57 },
      body1: { fontSize: "1rem", lineHeight: 1.5 },
      body2: { fontSize: "0.875rem", lineHeight: 1.57 },
      caption: { fontSize: "0.75rem", lineHeight: 1.5 },
      overline: {
        fontWeight: 700,
        fontSize: "0.75rem",
        lineHeight: 1.5,
        textTransform: "uppercase",
      },
      button: { fontWeight: 600, fontSize: "0.875rem", textTransform: "none" },
    },
    shape: { borderRadius: radius.sm },
    shadows: buildShadows() as Theme["shadows"],
    customShadows,
    components: {
      /*
       * Stack 一律用 gap 排間距(STYLE-09):MUI 預設的 margin 模式會把直接子元素的 margin 歸零,
       * 並用第二個起的子元素的 margin 排欄距 —— 子元素自己寫的 `ml` / `mt` 無效、換行後首欄對不齊。
       */
      MuiStack: {
        defaultProps: { useFlexGap: true },
      },
      /*
       * 勾選 / 開關的標籤外框左緣對齊輸入框(STYLE-09):MUI 預設 `margin-left: -11px`,
       * 讓控制項凸出同一欄的 TextField 左緣。右邊 16px 照舊(並排時的間距)。
       */
      MuiFormControlLabel: {
        styleOverrides: {
          /*
           * 開關與標籤之間留 8px:Checkbox / Radio 自帶 9px 內距所以標籤不貼,
           * 但 `Switch` 為了對齊 Figma 幾何把內距歸零(Draft/Switch 88:216),標籤就貼在軌道上;
           * 間距照 BS-12 的開關列(`289:86755`)補回來,只套在包了 Switch 的那種。
           */
          root: ({ theme }) => ({
            marginLeft: 0,
            "&:has(.MuiSwitch-root)": { gap: theme.spacing(1) },
          }),
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            boxShadow: "none",
            /*
             * 文字垂直置中(#183):MUI 預設 `line-height: 1.75`,行框比字框高出的部分
             * 依字型的 ascent / descent 分配 —— 中文字(整格高)因此偏離按鈕中線約 1px,
             * 在 contained(填色)按鈕上看得很明顯。改成 `line-height: 1` 讓行框等於字框,
             * 高度改由下面各尺寸的固定值決定(Figma Button 32 / 36 / 48),上下就完全對稱。
             */
            lineHeight: 1,
            "&:hover": { boxShadow: "none" },
            variants: [
              {
                props: { variant: "contained", color: "primary" },
                style: {
                  boxShadow: customShadows.primary,
                  "&:hover": { boxShadow: "none" },
                },
              },
            ],
          },
          // Figma Button:small 32(87:218)、medium 36(31:155)、large 48
          sizeSmall: { height: 32 },
          sizeMedium: { height: 36 },
          sizeLarge: { height: 48 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: radius.lg,
            boxShadow: customShadows.card,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: radius.sm },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: radius.lg,
            boxShadow: customShadows.dialog,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: radius.md,
            boxShadow: customShadows.dropdown,
          },
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: {
            borderRadius: radius.md,
            boxShadow: customShadows.dropdown,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: grey[800],
            borderRadius: radius.sm,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: "none", fontWeight: 600 },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: ({ theme }) => ({
            color: theme.vars.palette.text.secondary,
            backgroundColor: theme.vars.palette.background.default,
            fontWeight: 600,
          }),
        },
      },
    },
  });
};
