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
 * 表單分區用 `FormSectionCard`。直接用 ui 的 `Section` 會漏掉收合記憶。
 */
const SECTION_WRAPPERS = [
  "src/components/base/Section/Section.tsx",
  "src/components/base/form-engine/FormRenderer/FormSectionCard.tsx",
];

/**
 * 查詢字串只有 `useUrlState` 能碰(REACT-14):頁面、元件一律經 `@/hooks/base/useUrlState`,
 * 不直接用 react-router 的 `useSearchParams`,也不直接用 nuqs。放行的只有 hook 本身(與它的測試)和掛 adapter 的 `RootProviders`。
 */
const URL_STATE_OWNERS = [
  "src/hooks/base/useUrlState.ts",
  "src/hooks/base/useUrlState.test.tsx",
  "src/app/providers/RootProviders.tsx",
];

const URL_STATE_MESSAGE =
  "頁面狀態放網址一律經 @/hooks/base/useUrlState(REACT-14),不直接讀寫查詢字串、不直接用 nuqs";

const sectionPath = {
  name: "@repo/ui/section",
  message:
    "頁面的可收合區塊用 @/components/base/Section/Section(會記住收合狀態);表單分區由 FormRenderer 處理",
};

const urlStatePaths = [
  {
    name: "react-router",
    importNames: ["useSearchParams"],
    message: URL_STATE_MESSAGE,
  },
  { name: "nuqs", message: URL_STATE_MESSAGE },
];

const urlStatePatterns = [{ group: ["nuqs/*"], message: URL_STATE_MESSAGE }];

/**
 * 同一條規則後寫的 options 會整個取代先寫的,所以依「放行哪一條」分三組各寫完整的一份:
 * 一般檔案兩條都擋;Section 包裝只擋查詢字串;useUrlState 的擁有者只擋 Section。
 */
const restrictedImports = ({ paths, patterns = [] }) => ({
  "no-restricted-imports": [
    "error",
    {
      ...wallOptions,
      patterns: [...wallOptions.patterns, ...patterns],
      paths,
    },
  ],
});

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  ...frontendStyle,
  ...projectOwnership,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [...SECTION_WRAPPERS, ...URL_STATE_OWNERS],
    rules: restrictedImports({
      paths: [sectionPath, ...urlStatePaths],
      patterns: urlStatePatterns,
    }),
  },
  {
    files: SECTION_WRAPPERS,
    rules: restrictedImports({
      paths: urlStatePaths,
      patterns: urlStatePatterns,
    }),
  },
  {
    files: URL_STATE_OWNERS,
    rules: restrictedImports({ paths: [sectionPath] }),
  },
];
