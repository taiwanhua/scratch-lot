import { ModuleEngine } from "@repo/graphql";

/**
 * 模組說明(`<模組 key>.help.md`)的純邏輯:檔名 → 模組 key、內容整理、三份來源(底座 / 專案新增 /
 * 專案替換)的合成與驗證、模組 → 該用哪一份(專屬檔優先,表單模組沒有專屬檔時退回通用檔)。
 * 真的去讀檔案的那一層在 `lib/base/help-registry.ts`(Vite 的 `import.meta.glob`,只有它碰得到打包器)。
 */

/** help.md 的副檔名;檔名其餘部分就是模組 key(`system.org-manager.help.md` → `system.org-manager`)。 */
const HELP_SUFFIX = ".help.md";

/**
 * glob 出來的路徑 → 模組 key;不是 help.md 的路徑回 null。
 * 路徑形如 `/src/md/module-help/system.org-manager.help.md`,分隔符兩種都吃(Windows 的 `\`)。
 */
export const moduleKeyFromHelpPath = (path: string): string | null => {
  if (!path.endsWith(HELP_SUFFIX)) {
    return null;
  }
  const fileName = path.split(/[/\\]/).at(-1) ?? "";
  const key = fileName.slice(0, -HELP_SUFFIX.length);
  return key === "" ? null : key;
};

/**
 * 去掉開頭那一層 `# 模組名`:彈窗標題已經寫了模組名(Figma Draft/HelpDialog 的內文
 * 就是從 `## 這個模組做什麼` 開始),再渲染一次是重複。只拔開頭連續空行後的第一個 `# `,
 * 內文中間的 h1(實務上沒有)保留。
 */
export const stripLeadingTitle = (markdown: string): string => {
  const lines = markdown.split("\n");
  const firstIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstIndex === -1 || !lines[firstIndex]?.startsWith("# ")) {
    return markdown;
  }
  return lines
    .slice(firstIndex + 1)
    .join("\n")
    .trimStart();
};

/**
 * 「模組 key → 說明內容」對照表。`files` 是 `import.meta.glob` 的產物(路徑 → 原始字串),
 * 測試可以直接餵一份假的進來。空白(或只有標題)的 help.md 視為沒有說明,不收進表裡。
 */
export const buildHelpRegistry = (
  files: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> => {
  const registry = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    const key = moduleKeyFromHelpPath(path);
    const body = stripLeadingTitle(content).trim();
    if (key !== null && body !== "") {
      registry.set(key, body);
    }
  }
  return registry;
};

/** 三份說明來源,各是「完整檔案路徑 → Markdown 原始碼」(`lib/base/help-registry.ts` 的三個 glob 產物)。 */
export interface HelpSources {
  /** 底座的說明(`md/module-help/base/`) */
  readonly base: Readonly<Record<string, string>>;
  /** 專案新增模組的說明(`md/module-help/project/additions/`) */
  readonly additions: Readonly<Record<string, string>>;
  /** 專案對底座說明的替換(`md/module-help/project/replacements/`) */
  readonly replacements: Readonly<Record<string, string>>;
}

interface HelpFile {
  readonly path: string;
  /** 去掉開頭標題、去頭尾空白之後的內容;空字串 = 沒有說明 */
  readonly body: string;
}

/** 一個來源 → 「模組 key → 檔案」;同一個來源裡兩個檔案對到同一個 key 就記一筆問題。 */
const keyHelpFiles = (
  label: string,
  files: Readonly<Record<string, string>>,
  problems: string[],
): ReadonlyMap<string, HelpFile> => {
  const byKey = new Map<string, HelpFile>();
  for (const [path, content] of Object.entries(files)) {
    const key = moduleKeyFromHelpPath(path);
    if (key === null) {
      continue;
    }
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { path, body: stripLeadingTitle(content).trim() });
    } else {
      problems.push(
        `${label}的模組 key「${key}」有兩份說明:${existing.path}、${path}`,
      );
    }
  }
  return byKey;
};

/**
 * 底座、專案新增、專案替換三份來源 → 一張「模組 key → 說明內容」對照表。
 * 專案要換掉底座的說明就放「替換」,不靠撞 key;底座的檔案留著,拿掉替換就回到原說明。
 *
 * 拒絕(丟錯並列出 key 與檔案路徑):同一個來源裡 key 重複(含同一份底座說明被替換兩次)、
 * 新增與底座撞 key、替換的對象不是底座的說明、替換的內容是空白。
 * 底座與新增的空白檔(或只有標題)照舊視為沒有說明、不收進表裡。不修改輸入。
 */
export const composeHelpRegistry = ({
  base,
  additions,
  replacements,
}: HelpSources): ReadonlyMap<string, string> => {
  const problems: string[] = [];
  const baseFiles = keyHelpFiles("底座", base, problems);
  const additionFiles = keyHelpFiles("專案新增", additions, problems);
  const replacementFiles = keyHelpFiles("專案替換", replacements, problems);

  for (const [key, file] of additionFiles) {
    const collided = baseFiles.get(key);
    if (collided !== undefined) {
      problems.push(
        `專案新增的說明「${key}」與底座相撞:${file.path}、${collided.path}(要換掉底座的說明請放進替換)`,
      );
    }
  }
  for (const [key, file] of replacementFiles) {
    if (!baseFiles.has(key)) {
      problems.push(`替換的對象「${key}」不是底座的說明:${file.path}`);
    }
    if (file.body === "") {
      problems.push(`替換的說明「${key}」是空白的:${file.path}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      ["模組說明登記有問題:", ...problems.map((line) => `- ${line}`)].join(
        "\n",
      ),
    );
  }

  const registry = new Map<string, string>();
  for (const files of [baseFiles, additionFiles, replacementFiles]) {
    for (const [key, { body }] of files) {
      if (body !== "") {
        registry.set(key, body);
      }
    }
  }
  return registry;
};

/**
 * 表單模組的通用說明(`form-module.help.md`)在對照表裡的 key。表單模組的畫面都由表單引擎組裝、
 * 操作方式相同,所以不必各放一份;有特殊需求才加 `<模組 key>.help.md` 專屬檔。
 */
export const FORM_MODULE_HELP_KEY = "form-module";

/** 查說明要用到的模組欄位(`me.modules` 的一筆)。 */
export interface HelpModule {
  key: string;
  engine: ModuleEngine;
}

/**
 * 模組 → 說明內容:專屬檔優先;沒有專屬檔、而且是表單模組(`engine` = FORM)→ 表單模組通用說明;
 * 都沒有 → undefined(「?」停用)。彈窗標題由呼叫端用模組名,所以通用檔各模組共用也標得出是哪個模組。
 */
export const resolveModuleHelp = (
  registry: ReadonlyMap<string, string>,
  module: HelpModule,
): string | undefined =>
  registry.get(module.key) ??
  (module.engine === ModuleEngine.Form
    ? registry.get(FORM_MODULE_HELP_KEY)
    : undefined);
