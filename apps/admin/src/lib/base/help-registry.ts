import {
  type HelpModule,
  composeHelpRegistry,
  resolveModuleHelp,
} from "./module-help";

/**
 * 打包進 bundle 的模組說明:Vite 在 build 時把每份 `<模組 key>.help.md` 以原始字串內嵌,
 * 不走執行期的 fetch — 說明跟著版本走,離線也讀得到。
 *
 * 三份來源各一個 glob,**全 app 只有這支寫 glob**:
 * - 底座的說明:`src/md/module-help/base/`
 * - 專案新增模組的說明:`src/md/module-help/project/additions/`
 * - 專案對底座說明的替換:`src/md/module-help/project/replacements/`(同 key 換掉底座那一份;拿掉就回到原說明)
 *
 * 專案的兩個目錄可以是空的。合成時有碰撞(重複 key、替換不存在的底座說明、空白替換…)會在載入時丟錯。
 *
 * `import.meta.glob` 是 Vite 的編譯期轉換,jest 沒有;測試以 `moduleNameMapper` 把本模組換成
 * `src/test/help-registry.ts` 的假 registry(同一份介面),見 `apps/admin/jest.config.mjs`。
 * 所以**本檔只放 glob**,合成、驗證與查詢都在 `lib/base/module-help.ts`(那份有自己的單元測試)。
 */
const baseHelpFiles = import.meta.glob("/src/md/module-help/base/*.help.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const additionHelpFiles = import.meta.glob(
  "/src/md/module-help/project/additions/*.help.md",
  { query: "?raw", import: "default", eager: true },
);

const replacementHelpFiles = import.meta.glob(
  "/src/md/module-help/project/replacements/*.help.md",
  { query: "?raw", import: "default", eager: true },
);

const registry = composeHelpRegistry({
  base: baseHelpFiles,
  additions: additionHelpFiles,
  replacements: replacementHelpFiles,
});

/**
 * 模組 → 說明內容(Markdown 原始碼):專屬檔優先,表單模組退回通用檔(`resolveModuleHelp`);
 * 都沒有時回 undefined。
 */
export const moduleHelpMarkdown = (module: HelpModule): string | undefined =>
  resolveModuleHelp(registry, module);
