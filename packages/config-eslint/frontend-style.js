import { defineConfig } from "eslint/config";

/**
 * 前端程式碼風格(ADR-0012;規範 GEN-01、STRUCT-03、REACT-01 / 07)。
 * 各前端包(admin / front / ui)完成重構的那個 PR 才把它加進自己的 eslint.config;
 * 沒加之前既有程式碼不會紅。用法:
 *   import { config } from "@repo/eslint-config/vite";
 *   import { frontendStyle } from "@repo/eslint-config/frontend-style";
 *   /** @type {import("eslint").Linter.Config[]} *\/
 *   export default [...config, ...frontendStyle];
 * 後台另接 `projectOwnership`(底座 / 專案的所有權方向,見檔尾):`[...config, ...frontendStyle, ...projectOwnership]`;
 * `packages/ui` 另接 `uiOwnership`(不 import apps、不放專案程式):`[...config, ...frontendStyle, ...uiOwnership]`。
 *
 * 檔名規則只看第一段(unicorn 的 multipleFileExtensions 預設):`RouteTabs.drag.test.tsx` 檢 `RouteTabs`、
 * `vite-env.d.ts` 檢 `vite-env`,第二段以後不管。
 */

/** 元件檔 PascalCase(`SideNav.tsx`、`SideNav.test.tsx`、`Button.stories.tsx`);只看檔名,資料夾命名靠規範與 review(GEN-01)。 */
const componentFiles = {
  files: ["**/*.tsx"],
  ignores: [
    // app 組裝層的非元件 tsx(進入點、路由表、登記表)
    "**/main.tsx",
    "**/routes.tsx",
    "**/module-pages.tsx",
    // 測試支援檔(MSW handlers、renderApp)不是元件,維持 kebab
    "**/test/**",
    // Next.js app router 的路由檔由框架命名
    "**/app/**/page.tsx",
    "**/app/**/layout.tsx",
    "**/app/**/loading.tsx",
    "**/app/**/error.tsx",
    "**/app/**/not-found.tsx",
    "**/app/**/template.tsx",
    "**/app/**/default.tsx",
    "**/app/**/global-error.tsx",
    "**/app/**/forbidden.tsx",
    "**/app/**/unauthorized.tsx",
    "**/app/**/icon.tsx",
    "**/app/**/apple-icon.tsx",
    "**/app/**/opengraph-image.tsx",
    "**/app/**/twitter-image.tsx",
    "**/mdx-components.tsx",
  ],
  rules: {
    "unicorn/filename-case": [
      "error",
      { case: "pascalCase", checkDirectories: false },
    ],
  },
};

/** hook 檔 camelCase(`useMe.ts`、`useRouteTabsStore.ts`)。 */
const hookFiles = {
  // 也抓 `use-me.ts` 這種寫成 kebab 的 hook,讓它被要求改成 camelCase
  files: ["**/use[A-Z]*.ts", "**/use[A-Z]*.tsx", "**/use-*.ts", "**/use-*.tsx"],
  rules: {
    "unicorn/filename-case": [
      "error",
      { case: "camelCase", checkDirectories: false },
    ],
  },
};

/** 其餘(工具、常數、型別、設定、測試支援)kebab-case;沿用 unicorn 預設,這裡只是把它寫明。 */
const otherFiles = {
  files: ["**/*.ts"],
  ignores: ["**/use[A-Z]*.ts", "**/use-*.ts"],
  rules: {
    "unicorn/filename-case": [
      "error",
      { case: "kebabCase", checkDirectories: false },
    ],
  },
};

/** 寫法:箭頭函數、元件用 arrow、單檔上限。 */
const style = {
  files: ["**/*.{ts,tsx}"],
  rules: {
    // 元件、hook、一般函式一律箭頭函數(REACT-01);需要 overload / function* 的以行內豁免附原因(STRUCT-05)
    "func-style": ["error", "expression", { allowArrowFunctions: true }],
    "prefer-arrow-callback": "error",
    "react/function-component-definition": [
      "error",
      {
        namedComponents: "arrow-function",
        unnamedComponents: "arrow-function",
      },
    ],
    // 300 行是目標(REACT-07),400 是 lint 的硬上限
    "max-lines": [
      "error",
      { max: 400, skipBlankLines: true, skipComments: true },
    ],
  },
};

/**
 * 分層 import 方向(STRUCT-03):app → pages → components → hooks / stores → lib。
 * 以 target(被 import 的層)禁止 from(上層)的方式宣告;路徑相對於各包根目錄(turbo 在包目錄執行 lint)。
 */
const layeringZones = [
  {
    target: "./lib",
    from: ["./hooks", "./stores", "./components", "./pages", "./app"],
    message: "lib 是最底層,不能 import 上層(STRUCT-03)",
  },
  {
    target: ["./hooks", "./stores"],
    from: ["./components", "./pages", "./app"],
    message: "hooks / stores 不能 import components、pages、app(STRUCT-03)",
  },
  {
    target: "./components",
    from: ["./pages", "./app"],
    message: "components 不能 import pages、app(STRUCT-03)",
  },
  {
    target: "./pages",
    from: "./app",
    message: "pages 不能 import app(STRUCT-03)",
  },
];

const layering = {
  files: ["src/**/*.{ts,tsx}"],
  rules: {
    "import-x/no-restricted-paths": [
      "error",
      { basePath: "./src", zones: layeringZones },
    ],
  },
};

export const frontendStyle = defineConfig(
  componentFiles,
  hookFiles,
  otherFiles,
  style,
  layering,
);

/** 各層放專案內容的資料夾(`src/<層>/project/`);其餘都是底座維護的檔案。 */
const PROJECT_LAYERS = ["app", "pages", "components", "hooks", "stores", "lib"];

/**
 * 底座 / 專案的所有權方向(後台;接在 `frontendStyle` 之後):
 * - 底座的檔案不能 import 專案來源(`src/<層>/project/`)—— 否則底座更新時會被專案內容卡住。
 *   只有固定組裝入口 `src/app/module-pages.tsx` 同時看得到兩邊;`src/test/**` 的測試支援檔不受這條限制
 * - 專案頁(`src/pages/project/`)不能 import 底座頁(`src/pages/base/`)的內部;要共用就走 components / hooks / lib
 *
 * 同一條規則(`import-x/no-restricted-paths`)後寫的設定會整個取代先寫的 options,所以這裡每一組 zones 都把
 * 分層的 `layeringZones` 帶在前面:所有權是「加上去」的,原本的分層方向對每個檔案照樣生效。
 * 被 `ignores` 排除的檔案(專案檔、固定入口、test)仍套用 `frontendStyle` 的分層,不是整個豁免。
 */
export const projectOwnership = defineConfig(
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      ...PROJECT_LAYERS.map((layer) => `src/${layer}/project/**`),
      "src/app/module-pages.tsx",
      "src/test/**",
    ],
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: "./src",
          zones: [
            ...layeringZones,
            {
              target: "./",
              from: PROJECT_LAYERS.map((layer) => `./${layer}/project`),
              message:
                "底座的檔案不能 import 專案來源(src/<層>/project/);只有固定組裝入口 app/module-pages.tsx 可以",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/pages/project/**/*.{ts,tsx}"],
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: "./src",
          zones: [
            ...layeringZones,
            {
              target: "./pages/project",
              from: "./pages/base",
              message:
                "專案頁不能 import 底座頁的內部(pages/base/);要共用就經 components / hooks / lib",
            },
          ],
        },
      ],
    },
  },
);

/** app workspace 的套件名(`apps/<name>` 的 `@repo/<name>`);`packages/ui` 一個都不能 import。 */
const APP_PACKAGES = [
  "admin",
  "api",
  "db-migrator",
  "e2e",
  "front",
  "storybook",
];

/**
 * `@repo/ui` 只放底座的底層元件(STRUCT-12;接在 `frontendStyle` 之後,只給 `packages/ui` 用):
 * - 不能 import `apps/` 的任何路徑:相對路徑走進 `apps/`,或 `@repo/admin`、`@repo/front` 等 app 套件
 * - 不能有 `project/` 目錄:專案元件放 admin 的 `components/project/`,不進 `@repo/ui`;
 *   `project/` 底下的程式檔一律報錯(非程式檔由 `packages/ui/scripts/check-ownership-lint.mjs` 掃目錄把關)
 */
export const uiOwnership = defineConfig(
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: `(^|/)apps/|^@repo/(${APP_PACKAGES.join("|")})(/|$)`,
              message:
                "@repo/ui 不能 import apps/ 的程式(STRUCT-12);共用的東西放進 ui 自己,app 專用的留在 app",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/project/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program",
          message:
            "@repo/ui 不能有 project/ 目錄(STRUCT-12):專案元件放 admin 的 components/project/",
        },
      ],
    },
  },
);
