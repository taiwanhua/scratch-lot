import {
  type HelpModule,
  type HelpSources,
  composeHelpRegistry,
  resolveModuleHelp,
} from "../lib/base/module-help";

/**
 * `lib/base/help-registry.ts` 的測試替身(jest `moduleNameMapper` 換掉,見 `jest.config.mjs`)。
 * 真的那份用 Vite 的 `import.meta.glob` 把三份來源(底座 / 專案新增 / 專案替換)的 `*.help.md` 打包進 bundle —
 * jest 沒有這個編譯期轉換,所以測試改用這份假的檔案表,介面(`moduleHelpMarkdown`)一模一樣,
 * 合成與驗證走同一支 `composeHelpRegistry`。
 *
 * 預設值刻意只有幾個模組、內容也不是正本(正本是 md 檔,會一直改;測試不該跟著改),
 * 但形狀照 help.md 的慣例:`# 模組名` + `## 小節` + 清單。預設的專案來源是空的(與正式登記相同)。
 */
const DEFAULT_HELP_FILES: Record<string, string> = {
  "/src/md/module-help/base/overview.help.md": [
    "# 總覽",
    "",
    "## 這個模組做什麼",
    "",
    "一眼看到目前組織的重點。",
  ].join("\n"),
  "/src/md/module-help/base/system.org-manager.help.md": [
    "# 組織管理",
    "",
    "## 這個模組做什麼",
    "",
    "維護組織樹:新增下層組織、編輯資料、停用或刪除。",
    "",
    "## 常用操作",
    "",
    "- **開通租戶**:建立一個新的頂層組織。",
    "- **編輯組織**:改名稱、描述、商標。",
  ].join("\n"),
  "/src/md/module-help/base/system.role-manager.help.md": [
    "# 角色管理",
    "",
    "## 這個模組做什麼",
    "",
    "角色是一組權限的集合。",
    "",
    "## 常用操作",
    "",
    "- **建立角色**:選擇所屬組織、名稱與描述。",
    "- **分配使用者**:只能選該組織或其下層組織的人。",
  ].join("\n"),
  "/src/md/module-help/base/form-module.help.md": [
    "# 表單模組",
    "",
    "## 這個模組做什麼",
    "",
    "填寫與查看申請單。",
  ].join("\n"),
};

/** 專案的兩份來源(新增 / 替換);沒給的那一份是空的。 */
export type ProjectHelpFiles = Partial<
  Pick<HelpSources, "additions" | "replacements">
>;

const compose = (
  base: Readonly<Record<string, string>>,
  project: ProjectHelpFiles = {},
): ReadonlyMap<string, string> =>
  composeHelpRegistry({
    base,
    additions: project.additions ?? {},
    replacements: project.replacements ?? {},
  });

let registry = compose(DEFAULT_HELP_FILES);

/**
 * 換一份假的檔案表(測「這個模組沒有 help.md」之類的情境);`setup.ts` 每個測試後歸零。
 * 第一個參數是底座的說明;第二個選填,給專案的新增與替換(合成規則同正式的 registry,碰撞一樣會丟錯)。
 */
export const setHelpFiles = (
  files: Readonly<Record<string, string>>,
  project?: ProjectHelpFiles,
): void => {
  registry = compose(files, project);
};

/** 回到預設的假檔案表。 */
export const resetHelpFiles = (): void => {
  registry = compose(DEFAULT_HELP_FILES);
};

/** 與 `lib/base/help-registry.ts` 同名同形的查詢函式(同一條專屬檔優先、表單模組退回通用檔)。 */
export const moduleHelpMarkdown = (module: HelpModule): string | undefined =>
  resolveModuleHelp(registry, module);
