import {
  frontendStyle,
  projectOwnership,
} from "@repo/eslint-config/frontend-style";
import {
  designSystemWall,
  typographyColorRestriction,
} from "@repo/eslint-config/react";
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

/**
 * 同一層並排的表單欄位 `size` 要一致(STYLE-10):每種欄位不給 `size` 都是 medium(`@repo/ui` 的契約,
 * `packages/ui/src/test/field-size.test.tsx` 鎖著),所以隔壁寫了 `size="small"`、自己沒寫的那格會高一截
 * (組織欄、日期欄沒寫 size 就是這樣比同列高)。只看同一個父元素底下直接並排的欄位;包在條件式或 helper 裡的看不到,靠 review。
 */
const FIELD = `JSXOpeningElement[name.name=/^(TextField|SelectField|Autocomplete|DatePicker|DateTimePicker|OrgTreeSelect|ShareOrgsField|ModuleIconPicker)$/]`;
const SMALL_FIELD = `JSXElement:has(> ${FIELD}:has(> JSXAttribute[name.name="size"][value.value="small"]))`;
/**
 * 沒寫 size 或明寫 medium。spread 單純識別字(`{...SMALL}`、`{...fieldProps}`)的可能帶著 size,看不出來就不判;
 * 函式呼叫、條件式等其他 spread(`{...fieldErrorProps(...)}` 只帶錯誤訊息)照判。
 */
const MEDIUM_FIELD = [
  `JSXElement:has(> ${FIELD}:not(:has(> JSXAttribute[name.name="size"])):not(:has(> JSXSpreadAttribute[argument.type="Identifier"])))`,
  `JSXElement:has(> ${FIELD}:has(> JSXAttribute[name.name="size"][value.value="medium"]))`,
];
const FIELD_SIZE_MESSAGE =
  '同一層並排的表單欄位 size 要一致(STYLE-10):不給 size 是 medium,隔壁是 size="small" 就一起明寫 small';
const fieldSizeSiblings = {
  "no-restricted-syntax": [
    "error",
    ...MEDIUM_FIELD.flatMap((medium) => [
      `${SMALL_FIELD} ~ ${medium}`,
      `${medium} ~ ${SMALL_FIELD}`,
    ]).map((selector) => ({ selector, message: FIELD_SIZE_MESSAGE })),
    // 同一條規則後寫的 options 會整個取代先寫的:帶上共用設定的 Typography color 規則(STYLE-12)
    typographyColorRestriction,
  ],
};

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
  {
    files: ["src/**/*.tsx"],
    rules: fieldSizeSiblings,
  },
];
