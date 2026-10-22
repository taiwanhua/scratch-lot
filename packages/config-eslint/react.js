import pluginJsxA11y from "eslint-plugin-jsx-a11y";
import pluginReact from "eslint-plugin-react";
import pluginReactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

import { config as baseConfig } from "./index.js";

/**
 * Typography 的 `color` 只收 MUI 正式值(STYLE-12):`text.secondary`、`warning.main` 這類帶點的
 * theme 路徑 MUI 不認,會畫成一般字色;MUI 型別放寬成 `string & {}`,check-types 抓不到。
 * 只看值位置(屬性值、三元式的兩支、`??` / `||`),條件裡的 i18n key 這類字串不算。
 * 色階(`warning.dark`)改用 `sx={{ color }}`。
 * 其他設定若也寫 `no-restricted-syntax`,後寫的 options 會整個取代這一條,要把它一起帶上。
 */
const typographyColorAttr =
  "JSXOpeningElement[name.name=/^(Mui)?Typography$/] > JSXAttribute[name.name='color']";

export const typographyColorRestriction = {
  selector: [
    `${typographyColorAttr} > Literal[value=/\\./]`,
    `${typographyColorAttr} :matches(JSXExpressionContainer, ConditionalExpression, LogicalExpression) > Literal[value=/\\./]`,
  ].join(", "),
  message:
    'Typography 的 color 用正式值(textSecondary、textPrimary、textDisabled、error、warning…);指定色階改用 sx={{ color: "warning.dark" }}(docs/standards/react/styling.md STYLE-12)',
};

/**
 * A custom ESLint configuration for libraries that use React.
 */
export const config = [
  ...baseConfig,
  pluginReact.configs.flat.recommended,
  pluginReact.configs.flat["jsx-runtime"],
  pluginJsxA11y.flatConfigs.recommended,
  {
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  pluginReactHooks.configs.flat.recommended,
  {
    rules: {
      // 與設計系統之牆同一處維護;apps 與 packages/ui 都套(ui 內部也直接用 MuiTypography)
      "no-restricted-syntax": ["error", typographyColorRestriction],
    },
  },
];

/**
 * 設計系統之牆(STYLE-05):給 apps(front/admin)用,packages/ui 不套。
 * apps 不直接 import MUI/Emotion — 一律經 @repo/ui;缺的元件先到 ui 包一層再用。
 */
export const designSystemWall = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@mui/*", "@emotion/*"],
            message:
              "apps 不直接 import MUI/Emotion,改從 @repo/ui 匯入;缺的元件先到 packages/ui 包一層(docs/standards/react/styling.md STYLE-05)",
          },
        ],
      },
    ],
  },
};
