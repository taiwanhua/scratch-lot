import {
  frontendStyle,
  projectOwnership,
} from "@repo/eslint-config/frontend-style";
import { designSystemWall } from "@repo/eslint-config/react";
import { config } from "@repo/eslint-config/vite";

/** 設計系統之牆的 patterns(STYLE-05);同一條規則後寫的 options 會整個取代先寫的,所以下面要帶著它一起寫。 */
const [, wallOptions] = designSystemWall.rules["no-restricted-imports"];

/**
 * `@repo/ui/section` 只給兩個包裝用:一般頁面用 `components/base/Section`(依頁面 id + 區塊 key 記住收合狀態),
 * 表單分區用 `FormSectionCard`。直接用 ui 的 `Section` 會漏掉收合記憶(底座 10.3)。
 */
const SECTION_WRAPPERS = [
  "src/components/base/Section/Section.tsx",
  "src/components/base/form-engine/FormRenderer/FormSectionCard.tsx",
];

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  ...frontendStyle,
  ...projectOwnership,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: SECTION_WRAPPERS,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          ...wallOptions,
          paths: [
            {
              name: "@repo/ui/section",
              message:
                "頁面的可收合區塊用 @/components/base/Section/Section(會記住收合狀態);表單分區由 FormRenderer 處理(底座 10.3)",
            },
          ],
        },
      ],
    },
  },
];
