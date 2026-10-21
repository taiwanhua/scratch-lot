import preset from "@repo/jest-presets/browser-esm/jest-preset.mjs";

/** @type {import('jest').Config} */
const shared = {
  preset: "@repo/jest-presets/browser-esm",
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
  // 先列的先贏:特例要排在通則 `^@/(.*)$` 前面
  moduleNameMapper: {
    // 模組說明的 registry 用 Vite 的 `import.meta.glob` 把 help.md 打包進 bundle;
    // jest 沒有那個編譯期轉換,整支換成介面相同的假 registry(內容由測試用 `setHelpFiles` 決定)
    "^@/lib/base/help-registry$": "<rootDir>/src/test/help-registry.ts",
    // `@/` = src/(GEN-01 路徑別名;與 tsconfig paths、vite alias 同一份約定)
    "^@/(.*)$": "<rootDir>/src/$1",
    // Vite 才懂的資源匯入(css / 字型)在測試中以空模組代替
    "\\.css$": "<rootDir>/src/test/empty-module.ts",
  },
};

/**
 * 以固定夾具頂替「專案來源」的 project:只跑 `*.<name>.test.ts(x)`,整張模組圖(含 setup、stores、lib、
 * 組裝入口)讀到的都是夾具的值。被換掉的只有 `replaces` 列出的那幾支,其餘都是正式程式。
 */
const fixtureProjects = [
  // 替代品牌(新專案的形狀,沒有側欄舊鍵):驗「只換專案值,讀取接線就跟著換,且不碰別的專案的鍵」
  {
    name: "alt-project",
    replaces: {
      "^@repo/project-config/public$":
        "<rootDir>/src/test/alternative-project.ts",
    },
  },
  // 固定的 CookHome 歷史值:驗既有瀏覽器裡的鍵、資料格式、側欄舊鍵搬移與原畫面輸出
  {
    name: "legacy-project",
    replaces: {
      "^@repo/project-config/public$":
        "<rootDir>/src/test/cookhome-legacy-project.ts",
    },
  },
  // 測試專案的頁面登記(新增頁 + 替換治理頁):只換 `app/project/` 的兩份來源,
  // 固定組裝入口 `app/module-pages.tsx`、路由、守門、殼與說明都是真的
  {
    name: "project-fixture",
    replaces: {
      "^@/app/project/module-pages$":
        "<rootDir>/src/test/project-fixture/module-pages.ts",
      "^@/app/project/page-replacements$":
        "<rootDir>/src/test/project-fixture/page-replacements.ts",
    },
  },
].map(({ name, replaces }) => ({
  name,
  replaces,
  testRegex: String.raw`\.${name}\.test\.tsx?$`,
}));

/**
 * - `admin`:正式的 `@repo/project-config/public`(目前的專案值)與正式的 `app/project/` 登記(專案新增的頁與替換的底座頁都生效;
 *   底座頁被替換時,底座測試經路由看到的是專案版,專案頁要的假 api 由 `src/test/msw/project/default-handlers.ts` 預設提供),跑所有一般測試。
 *   一般測試不寫任何專案的字面值 —— 換專案只改專案值檔,這些測試不必跟著改
 * - 其餘 project 見 `fixtureProjects`
 *
 * @type {import('jest').Config}
 */
const config = {
  // `testTimeout` 是全域選項:寫在 project 裡(含 project 的 preset)不生效,會退回 jest 預設的 5 秒。
  // 所以在根層沿用 preset 放寬過的值,不另寫一個數字
  testTimeout: preset.testTimeout,
  projects: [
    {
      ...shared,
      displayName: "admin",
      testPathIgnorePatterns: [
        "/node_modules/",
        ...fixtureProjects.map((project) => project.testRegex),
      ],
    },
    ...fixtureProjects.map(({ name, replaces, testRegex }) => ({
      ...shared,
      displayName: name,
      testRegex,
      // 夾具的鍵排在通則 `^@/(.*)$` 前面才生效(先列的先贏)
      moduleNameMapper: { ...replaces, ...shared.moduleNameMapper },
    })),
  ],
};

export default config;
