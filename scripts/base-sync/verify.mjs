/**
 * `verify`:唯讀。升級完成(merge 已提交)後,核對專案的改動是否已被新底座包含,產出 Markdown 報告
 * (操作正本:docs/deployment.md「底座首次接軌與版本升級」的升級後檢查)。四節:
 *
 *   1. 非專案、非混合路徑(common / published-data / unknown)與新底座 tag 仍不同的檔案:沒回收到、漂移或改寫已發布資料
 *   2. 所有客製替換登記:頁面替換、help 替換、專案表單模組的 options / pageOverrides
 *   3. 同一個 collection + key 同時宣告在底座 seed 與專案 seed,以及專案 seed 裡無法解析的 key
 *   4. 專案路徑內與底座同名或同匯出名稱的檔案
 *
 * 「底座」一律取新底座 tag 的 commit,「專案」一律取專案已提交的 HEAD;不讀工作樹、不 fetch、不寫任何 ref。
 * tag 取自 upgrade 存的 `refs/base/releases/<tag>`,且 HEAD 必須已包含它。任一節有項目即 exit 1,人只判讀例外。
 *
 * 第 2–4 節是靜態文字掃描,不執行專案的 TypeScript(seed 組裝要 tsx 與已安裝的依賴,且本工具只執行 git / gh;
 * 正式組裝 `seeds/registry.ts` 在載入時就拒絕底座與專案撞 key,CI 已涵蓋,verify 補的是它看不到的寫法)。
 * 各節的漏報 / 誤報範圍:
 *   1. 混合路徑不列(另以 inspect 的 mixed 清單核對);沒有誤報,差異即項目
 *   2. 只認上述三種登記;spread、變數等讀不懂的寫法照列為「無法靜態解析」(多列,不漏列)
 *   3. key 只解析字串、常數(跨檔、可組合,含 src/seed/ 執行器的常數)、`${常數}` 樣板、`permissionKey()`,
 *      以及 formModuleDeclaration() 依 helper 本身宣告推導的頁面 / 權限 key;其他寫法在專案端列為
 *      「無法解析的 key」、底座端只計數。collection 由 nodes / permissions 陣列、formModuleDeclaration() 或所在 set
 *      的 collection 判定,讀不出時只比 key(可能誤報)。推導出的 wildcard 權限與 data_scope_targets 不另比
 *      (由模組 key 涵蓋);未被 import 的 revisions 快照不算目前宣告(漏報其中的 key)
 *   4. 只比 project/ 路徑的程式檔(不含 STRUCT-12 成對固定來源、專案值與 seed / migration)與底座 common
 *      程式檔的檔名(不含 index)與具名匯出(不含 default);常見名稱可能誤報,改名後的重複會漏報
 * Figma 稽核與 CI 不在本指令內。
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { classifyPath } from "./classify.mjs";
import { fail } from "./errors.mjs";
import {
  diffFiles,
  git,
  isAncestor,
  requireRepositoryRoot,
  resolveRef,
} from "./git.mjs";
import { isTagName, loadProject } from "./identity.mjs";

const RELEASE_PREFIX = "refs/base/releases/";

export const PAGE_REPLACEMENTS =
  "apps/admin/src/app/project/page-replacements.ts";
export const PROJECT_MODULE_PAGES =
  "apps/admin/src/app/project/module-pages.ts";
export const HELP_REPLACEMENTS =
  "apps/admin/src/md/module-help/project/replacements/";
const BASE_SEEDS = "apps/db-migrator/seeds/base/";
const PROJECT_SEEDS = "apps/db-migrator/seeds/project/";
const SEED_RUNTIME = "apps/db-migrator/src/seed/";

const CODE_FILE = /\.[cm]?[jt]sx?$/;

/**
 * 第 4 節不比的專案檔:STRUCT-12 的專案固定來源(檔名本來就與底座那一份成對)、專案值(project-config)、
 * 以及 seed / migration(資料,不是程式;seed 由第 3 節比 key)。
 */
const PAIRED_PROJECT_SOURCES = new Set([
  PAGE_REPLACEMENTS,
  PROJECT_MODULE_PAGES,
  "apps/api/src/project/api-modules.ts",
  "apps/api/src/project/project.module.ts",
  "apps/api/src/project/database/registrations.ts",
  "apps/api/src/project/lookup-providers.ts",
  "apps/api/src/project/realtime-boards.ts",
  "apps/admin/src/app/project/realtime-signals.ts",
  "apps/api/src/project/user-preferences.ts",
  "apps/api/src/project/form-lifecycles.ts",
  "apps/api/src/project/notifications.ts",
]);
const NOT_CODE_DUPLICATES = [
  /^packages\/project-config\/src\/project\//,
  /^apps\/db-migrator\/seeds\/project\//,
  /^apps\/db-migrator\/migrations\/project\//,
];

// ---------------------------------------------------------------- Git 讀取

const listTree = (root, commit) =>
  git(root, ["ls-tree", "-r", "-z", "--name-only", commit])
    .split("\0")
    .filter((file) => file !== "");

/** 一次讀多個 blob(`git cat-file --batch`);回傳 path → 文字內容。 */
function readBlobs(root, commit, files) {
  const contents = new Map();
  if (files.length === 0) return contents;
  const result = spawnSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: files.map((file) => `${commit}:${file}\n`).join(""),
    maxBuffer: 1024 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error || result.status !== 0) fail("git cat-file 失敗");
  const out = result.stdout;
  let offset = 0;
  for (const file of files) {
    const end = out.indexOf(0x0a, offset);
    if (end === -1) fail("git cat-file 輸出不完整");
    const header = out.subarray(offset, end).toString("utf8").split(" ");
    offset = end + 1;
    if (header[1] === "missing") continue;
    const size = Number(header[2]);
    contents.set(file, out.subarray(offset, offset + size).toString("utf8"));
    offset += size + 1;
  }
  return contents;
}

// ---------------------------------------------------------------- 靜態掃描

const QUOTES = new Set(['"', "'", "`"]);
const OPEN = { "{": "}", "[": "]", "(": ")" };
const CLOSE = new Set(["}", "]", ")"]);

/** 跳過從 index 開始的字串字面值,回傳結束引號之後的位置。 */
function skipString(text, index) {
  const quote = text[index];
  let cursor = index + 1;
  while (cursor < text.length && text[cursor] !== quote) {
    cursor += text[cursor] === "\\" ? 2 : 1;
  }
  return cursor + 1;
}

/** 去掉註解(保留字串原樣與換行),之後的掃描不會被註解裡的範例誤導。 */
export function stripComments(text) {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (QUOTES.has(char)) {
      const end = skipString(text, index);
      out += text.slice(index, end);
      index = end;
    } else if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
    } else if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(index, stop).replaceAll(/[^\n]/g, "");
      index = stop;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

/** text[open] 是左括號;回傳對應右括號的位置(找不到回 -1)。 */
function matchingClose(text, open) {
  const stack = [];
  let index = open;
  while (index < text.length) {
    const char = text[index];
    if (QUOTES.has(char)) {
      index = skipString(text, index);
      continue;
    }
    if (OPEN[char]) stack.push(OPEN[char]);
    else if (CLOSE.has(char)) {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return index;
    }
    index += 1;
  }
  return -1;
}

/** 以頂層逗號切開陣列內容(括號、字串內的逗號不算)。 */
function splitTopLevel(inner) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let index = 0;
  while (index < inner.length) {
    const char = inner[index];
    if (QUOTES.has(char)) {
      index = skipString(inner, index);
      continue;
    }
    if (OPEN[char]) depth += 1;
    else if (CLOSE.has(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(inner.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  parts.push(inner.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** 物件字面值 `{ … }` 只留頂層:巢狀括號的內容挖空,字串保留。 */
function topLevel(objectText) {
  const inner = objectText.slice(1, -1);
  let out = "";
  let depth = 0;
  let index = 0;
  while (index < inner.length) {
    const char = inner[index];
    if (QUOTES.has(char)) {
      const end = skipString(inner, index);
      if (depth === 0) out += inner.slice(index, end);
      index = end;
      continue;
    }
    if (OPEN[char]) {
      if (depth === 0) out += char;
      depth += 1;
    } else if (CLOSE.has(char)) {
      depth -= 1;
      if (depth === 0) out += char;
    } else if (depth === 0) {
      out += char;
    }
    index += 1;
  }
  return out;
}

const withoutStrings = (text) =>
  text.replaceAll(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

/** 字串字面值(不含 `${}` 的樣板)→ 值;不是就回 null。 */
function literalValue(raw) {
  const match = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1$/.exec(raw.trim());
  if (!match || (match[1] === "`" && match[2].includes("${"))) return null;
  return match[2];
}

/** 頂層屬性的值原文(只認 `name: value`,值以頂層逗號為界)。 */
function propertyValue(objectText, name) {
  for (const part of splitTopLevel(objectText.slice(1, -1))) {
    const match = new RegExp(`^${name}\\s*:\\s*([\\s\\S]*)$`).exec(part);
    if (match) return match[1].trim();
  }
  return null;
}

/** 找 `pattern`(結尾是左方括號)之後的陣列元素;找不到回 null。 */
function arrayElements(text, pattern) {
  const match = pattern.exec(text);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  const close = matchingClose(text, open);
  if (close === -1) return null;
  return splitTopLevel(text.slice(open + 1, close));
}

const oneLine = (text) => text.replaceAll(/\s+/g, " ").trim();

// ---------------------------------------------------------------- 第 1 節

/** 第 1 節列的類別:專案路徑屬專案自己;混合路徑由 inspect 的 mixed 清單逐段核對,兩者不列。 */
const UNCONTRIBUTED_CATEGORIES = new Set([
  "common",
  "published-data",
  "unknown",
]);

function baseDifferences(root, tagCommit, head) {
  return diffFiles(root, tagCommit, head)
    .map(({ path: file, status }) => ({
      path: file,
      status,
      category: classifyPath(file, status),
    }))
    .filter((file) => UNCONTRIBUTED_CATEGORIES.has(file.category));
}

// ---------------------------------------------------------------- 第 2 節

function pageReplacementItems(text) {
  const elements = arrayElements(
    stripComments(text),
    /\bprojectPageReplacements\b[^=]*=\s*\[/,
  );
  if (elements === null) {
    return [
      {
        kind: "頁面替換",
        key: null,
        path: PAGE_REPLACEMENTS,
        note: "讀不出 projectPageReplacements 清單,請人工判讀",
      },
    ];
  }
  return elements.map((element) => {
    const target = element.startsWith("{")
      ? literalValue(propertyValue(element, "target") ?? "")
      : null;
    return target === null
      ? {
          kind: "頁面替換",
          key: null,
          path: PAGE_REPLACEMENTS,
          note: `無法靜態解析的登記:${oneLine(element)}`,
        }
      : { kind: "頁面替換", key: target, path: PAGE_REPLACEMENTS, note: null };
  });
}

function formOptionItems(text) {
  const stripped = stripComments(text);
  const elements = arrayElements(stripped, /\bforms\s*:\s*\[/);
  if (elements === null) {
    return [
      {
        kind: "表單模組設定",
        key: null,
        path: PROJECT_MODULE_PAGES,
        note: "讀不出 forms 清單,請人工判讀",
      },
    ];
  }
  const items = [];
  for (const element of elements) {
    if (!element.startsWith("{")) {
      items.push({
        kind: "表單模組設定",
        key: null,
        path: PROJECT_MODULE_PAGES,
        note: `無法靜態解析的登記:${oneLine(element)}`,
      });
      continue;
    }
    const keys = withoutStrings(topLevel(element));
    const settings = ["options", "pageOverrides"].filter((name) =>
      new RegExp(`\\b${name}\\b`).test(keys),
    );
    if (settings.length === 0) continue;
    const moduleKey = literalValue(propertyValue(element, "moduleKey") ?? "");
    items.push({
      kind: "表單模組設定",
      key: moduleKey,
      path: PROJECT_MODULE_PAGES,
      note: moduleKey === null ? `moduleKey 無法靜態解析` : settings.join("、"),
    });
  }
  return items;
}

function customizationItems(headFiles, headBlobs) {
  const items = [];
  if (headBlobs.has(PAGE_REPLACEMENTS)) {
    items.push(...pageReplacementItems(headBlobs.get(PAGE_REPLACEMENTS)));
  }
  for (const file of headFiles) {
    if (!file.startsWith(HELP_REPLACEMENTS)) continue;
    const name = path.posix.basename(file);
    if (name === ".gitkeep") continue;
    items.push({
      kind: "help 替換",
      key: name.endsWith(".help.md") ? name.slice(0, -".help.md".length) : null,
      path: file,
      note: null,
    });
  }
  if (headBlobs.has(PROJECT_MODULE_PAGES)) {
    items.push(...formOptionItems(headBlobs.get(PROJECT_MODULE_PAGES)));
  }
  return items;
}

// ---------------------------------------------------------------- 第 3 節

/** 型別註記(`key: string;`)不是宣告。 */
const TYPE_KEYWORDS = new Set(["string", "number", "unknown", "never", "any"]);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const CONSTANT_DECLARATION =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:\s*[\w$.<>[\]| ]+)?\s*=\s*/g;
const KEY_PROPERTY = /(?<![\w$.])key\s*:\s*/g;
/** 宣告陣列的屬性名 → collection(模組宣告的形狀與推導,見 seeds/base/module-declaration.ts)。 */
const ARRAY_COLLECTIONS = { nodes: "modules", permissions: "permissions" };
/** 以呼叫參數宣告模組的 helper(seeds/base/form-module-declaration.ts)。 */
const MODULE_HELPERS = new Set(["formModuleDeclaration"]);
const UNKNOWN_COLLECTION = "?";

/** 字串內容換成空白(長度不變),供結構掃描:字串裡的括號、逗號不算。 */
function skeletonOf(text) {
  let out = "";
  let index = 0;
  while (index < text.length) {
    if (QUOTES.has(text[index])) {
      const end = Math.min(skipString(text, index), text.length);
      const length = end - index;
      out +=
        length >= 2
          ? `${text[index]}${" ".repeat(length - 2)}${text[end - 1]}`
          : text[index];
      index = end;
    } else {
      out += text[index];
      index += 1;
    }
  }
  return out;
}

/** 從 start 讀一個運算式,直到頂層的 `,` `;` 或右括號。 */
function readExpression(skeleton, text, start) {
  let depth = 0;
  let index = start;
  while (index < skeleton.length) {
    const char = skeleton[index];
    if (OPEN[char]) depth += 1;
    else if (CLOSE.has(char)) {
      if (depth === 0) break;
      depth -= 1;
    } else if ((char === "," || char === ";") && depth === 0) break;
    index += 1;
  }
  return text.slice(start, index).trim();
}

/** 往回找包住 index 的左括號位置;沒有回 -1。 */
function enclosingOpen(skeleton, index) {
  let depth = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = skeleton[cursor];
    if (CLOSE.has(char)) depth += 1;
    else if (OPEN[char]) {
      if (depth === 0) return cursor;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * key 運算式 → 值:字串字面值、常數、`${常數}` 樣板、`permissionKey(模組, 動作)`(與 @repo/domain 同規則,以「.」相接)。
 * 其他寫法(函式參數、成員存取、外部套件的值、其他函式呼叫)回 null。
 */
export function resolveKeyExpression(expression, constants) {
  const raw = expression.trim().replace(/\s+as\s+const$/, "");
  const literal = /^(["'])((?:\\.|(?!\1)[^\\])*)\1$/.exec(raw);
  if (literal) return literal[2];
  if (raw.length >= 2 && raw.startsWith("`") && raw.endsWith("`")) {
    let isResolved = true;
    const value = raw.slice(1, -1).replaceAll(/\$\{([^}]*)\}/g, (_, inner) => {
      const part = resolveKeyExpression(inner, constants);
      if (part === null) isResolved = false;
      return part ?? "";
    });
    return isResolved ? value : null;
  }
  if (IDENTIFIER.test(raw)) return constants.get(raw) ?? null;
  const call = /^permissionKey\s*\(([\s\S]*)\)$/.exec(raw);
  if (call) {
    const args = splitTopLevel(call[1]);
    if (args.length !== 2) return null;
    const [moduleKey, action] = args.map((arg) =>
      resolveKeyExpression(arg, constants),
    );
    return moduleKey === null || action === null
      ? null
      : `${moduleKey}.${action}`;
  }
  return null;
}

/** 檔案裡 `const NAME = <運算式>` 的名稱與原文。 */
function constantExpressions(text) {
  const stripped = stripComments(text);
  const skeleton = skeletonOf(stripped);
  return [...skeleton.matchAll(CONSTANT_DECLARATION)].map((match) => [
    match[1],
    readExpression(skeleton, stripped, match.index + match[0].length),
  ]);
}

/** 常數表:反覆代換到不再變動(常數可由其他常數組成,跨檔)。 */
function constantTable(texts) {
  const pending = texts.flatMap(constantExpressions);
  const table = new Map();
  let isChanged = true;
  while (isChanged) {
    isChanged = false;
    for (const [name, expression] of pending) {
      if (table.has(name)) continue;
      const value = resolveKeyExpression(expression, table);
      if (value !== null) {
        table.set(name, value);
        isChanged = true;
      }
    }
  }
  return table;
}

/** key 所屬的 collection:往外找宣告陣列(nodes / permissions)、模組 helper 的呼叫或帶 `collection` 的 set。 */
function collectionOf(skeleton, text, objectOpen, constants) {
  let cursor = objectOpen;
  for (;;) {
    const parent = enclosingOpen(skeleton, cursor);
    if (parent === -1) return UNKNOWN_COLLECTION;
    const before = skeleton.slice(0, parent);
    if (skeleton[parent] === "[") {
      const property = /([A-Za-z_$][\w$]*)\s*:\s*$/.exec(before)?.[1];
      if (property && Object.hasOwn(ARRAY_COLLECTIONS, property)) {
        return ARRAY_COLLECTIONS[property];
      }
    } else if (skeleton[parent] === "(") {
      const callee = /([A-Za-z_$][\w$]*)\s*$/.exec(before)?.[1];
      if (callee && MODULE_HELPERS.has(callee)) return "modules";
    } else {
      const close = matchingClose(text, parent);
      const value =
        close === -1
          ? null
          : propertyValue(text.slice(parent, close + 1), "collection");
      if (value !== null) {
        return resolveKeyExpression(value, constants) ?? UNKNOWN_COLLECTION;
      }
    }
    cursor = parent;
  }
}

/**
 * seed 檔裡的 key 宣告 → `{ declared, unresolved, helperCalls }`:
 * declared / unresolved 是 `{ collection, key }` / `{ collection, expression }`;
 * helperCalls 是以模組 helper 宣告的模組(`{ helper, key }`),之後依 helper 本身的宣告展開推導出的 key。
 * `{ collection, key }` 形式的引用(關聯兩端、$seedRef)不是宣告;型別註記略過。
 */
export function seedKeys(text, constants) {
  const stripped = stripComments(text);
  const skeleton = skeletonOf(stripped);
  const declared = [];
  const unresolved = [];
  const helperCalls = [];
  for (const match of skeleton.matchAll(KEY_PROPERTY)) {
    const expression = readExpression(
      skeleton,
      stripped,
      match.index + match[0].length,
    );
    if (expression === "" || TYPE_KEYWORDS.has(expression)) continue;
    const objectOpen = enclosingOpen(skeleton, match.index);
    if (objectOpen === -1 || skeleton[objectOpen] !== "{") continue;
    const close = matchingClose(stripped, objectOpen);
    if (
      close !== -1 &&
      /\bcollection\s*:/.test(
        withoutStrings(topLevel(stripped.slice(objectOpen, close + 1))),
      )
    ) {
      continue;
    }
    const collection = collectionOf(skeleton, stripped, objectOpen, constants);
    const key = resolveKeyExpression(expression, constants);
    if (key === null) {
      unresolved.push({ collection, expression: oneLine(expression) });
      continue;
    }
    declared.push({ collection, key });
    const parent = enclosingOpen(skeleton, objectOpen);
    const callee =
      parent !== -1 && skeleton[parent] === "("
        ? /([A-Za-z_$][\w$]*)\s*$/.exec(skeleton.slice(0, parent))?.[1]
        : undefined;
    if (callee && MODULE_HELPERS.has(callee)) {
      helperCalls.push({ helper: callee, key });
    }
  }
  return { declared, unresolved, helperCalls };
}

/**
 * 模組 helper 推導出的 key(例如表單模組的 `${key}.view-page`、`permissionKey(key, "view")`):
 * 取 helper 定義檔裡以參數 `key` 組成的宣告當樣板,代入呼叫時的模組 key。不另寫一份推導規則。
 */
function helperTemplates(entries) {
  const templates = new Map();
  for (const helper of MODULE_HELPERS) {
    const definition = entries.find(({ text }) =>
      text.includes(`function ${helper}(`),
    );
    if (definition) templates.set(helper, definition.unresolved);
  }
  return templates;
}

function expandHelperCalls(entry, templates, constants) {
  return entry.helperCalls.flatMap(({ helper, key }) => {
    const scoped = new Map([...constants, ["key", key]]);
    return (templates.get(helper) ?? []).flatMap(
      ({ collection, expression }) => {
        const derived = resolveKeyExpression(expression, scoped);
        return derived === null ? [] : [{ collection, key: derived }];
      },
    );
  });
}

/** helper 定義檔裡能以參數 `key` 代入的樣板不是無法解析的宣告。 */
function isHelperTemplate(expression, constants) {
  return (
    resolveKeyExpression(
      expression,
      new Map([...constants, ["key", "key"]]),
    ) !== null
  );
}

const isRevision = (file) => file.includes("/revisions/");

/**
 * 一方目前的 seed 宣告檔:非快照的檔,加上被這些檔 import 的 revisions 快照(設計器匯出、直接當 seed 用的那種)。
 * 只給 migration 明示套用的歷史快照不算目前宣告(已發布快照不能刪,退場是以新增版本表達)。
 */
function liveSeedFiles(blobs, prefix) {
  const files = [...blobs.keys()].filter(
    (file) => file.startsWith(prefix) && CODE_FILE.test(file),
  );
  const currentText = files
    .filter((file) => !isRevision(file))
    .map((file) => blobs.get(file))
    .join("\n");
  return files.filter((file) => {
    if (!isRevision(file)) return true;
    const stem = path.posix.basename(file).replace(CODE_FILE, "");
    return currentText.includes(`revisions/${stem}`);
  });
}

const sameCollection = (a, b) =>
  a === b || a === UNKNOWN_COLLECTION || b === UNKNOWN_COLLECTION;

/**
 * 第 3 節:同 collection + key(任一方讀不出 collection 時只比 key)同時宣告在底座與專案的 seed,
 * 加上專案 seed 裡無法靜態解析的 key(可能與底座重複,須人判讀)。底座無法解析的只計數。
 */
function seedKeyFindings(baseBlobs, headBlobs) {
  const baseFiles = liveSeedFiles(baseBlobs, BASE_SEEDS);
  const projectFiles = liveSeedFiles(headBlobs, PROJECT_SEEDS);
  // 常數另取 seed 執行器的定義(如 API_MODULE_KEY),宣告檔會 import 它們
  const runtimeTexts = [...baseBlobs.keys()]
    .filter(
      (file) =>
        file.startsWith(SEED_RUNTIME) &&
        CODE_FILE.test(file) &&
        !file.includes(".test."),
    )
    .map((file) => baseBlobs.get(file));
  const baseTexts = [
    ...baseFiles.map((file) => baseBlobs.get(file)),
    ...runtimeTexts,
  ];
  const baseConstants = constantTable(baseTexts);
  // 專案可 import 底座的常數:兩方的常數一起代換
  const projectConstants = constantTable([
    ...baseTexts,
    ...projectFiles.map((file) => headBlobs.get(file)),
  ]);
  const scan = (blobs, files, constants) =>
    files.map((file) => ({
      file,
      text: blobs.get(file),
      ...seedKeys(blobs.get(file), constants),
    }));
  const base = scan(baseBlobs, baseFiles, baseConstants);
  const project = scan(headBlobs, projectFiles, projectConstants);
  // helper 由底座提供;專案呼叫的是同一份
  const templates = helperTemplates(base);
  for (const [entries, constants] of [
    [base, baseConstants],
    [project, projectConstants],
  ]) {
    for (const entry of entries) {
      entry.declared.push(...expandHelperCalls(entry, templates, constants));
    }
  }

  const duplicates = new Map();
  for (const { file, declared } of project) {
    for (const { collection, key } of declared) {
      const owners = base
        .filter((entry) =>
          entry.declared.some(
            (item) =>
              item.key === key && sameCollection(item.collection, collection),
          ),
        )
        .map((entry) => entry.file);
      if (owners.length === 0) continue;
      const id = `${key}\0${collection}`;
      const found = duplicates.get(id) ?? {
        kind: "duplicate",
        collection,
        key,
        base: owners,
        project: [],
      };
      if (!found.project.includes(file)) found.project.push(file);
      duplicates.set(id, found);
    }
  }
  const unresolved = project.flatMap(({ file, unresolved: expressions }) =>
    expressions.map(({ expression }) => ({
      kind: "unresolved",
      expression,
      path: file,
    })),
  );
  const order = (item) =>
    item.kind === "duplicate"
      ? `0${item.key}\0${item.collection}`
      : `1${item.path}\0${item.expression}`;
  return {
    items: [...duplicates.values(), ...unresolved].sort((a, b) =>
      order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0,
    ),
    baseUnresolved: base.reduce(
      (sum, entry) =>
        sum +
        entry.unresolved.filter(
          ({ expression }) =>
            !(
              [...templates.values()].includes(entry.unresolved) &&
              isHelperTemplate(expression, baseConstants)
            ),
        ).length,
      0,
    ),
  };
}

// ---------------------------------------------------------------- 第 4 節

const EXPORT_DECLARATION =
  /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;

/**
 * 檔案的具名匯出。default 匯出一律不列(`export default function Page`、`export { x as default }`):
 * 頁面元件多半以 default 匯出,名稱與底座撞名不代表重複,列了只會誤報。
 * `export { default as X }` 是具名匯出 X,照列。
 */
export function exportNames(text) {
  const stripped = stripComments(text);
  const names = new Set();
  for (const match of stripped.matchAll(EXPORT_DECLARATION)) {
    names.add(match[1]);
  }
  for (const match of stripped.matchAll(EXPORT_LIST)) {
    for (const part of match[1].split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name)) {
        names.add(name);
      }
    }
  }
  return names;
}

const stemOf = (file) => path.posix.basename(file).replace(CODE_FILE, "");

const isProjectCode = (file) =>
  classifyPath(file, "A") === "project" &&
  /(?:^|\/)project\//.test(file) &&
  CODE_FILE.test(file) &&
  !PAIRED_PROJECT_SOURCES.has(file) &&
  !NOT_CODE_DUPLICATES.some((pattern) => pattern.test(file));

function nameDuplicates(projectFiles, headBlobs, baseFiles, baseBlobs) {
  const byStem = new Map();
  const byExport = new Map();
  for (const file of baseFiles) {
    const stem = stemOf(file);
    if (stem !== "index") byStem.set(stem, [...(byStem.get(stem) ?? []), file]);
    for (const name of exportNames(baseBlobs.get(file) ?? "")) {
      byExport.set(name, [...(byExport.get(name) ?? []), file]);
    }
  }
  const items = [];
  for (const file of projectFiles) {
    const sameName = byStem.get(stemOf(file)) ?? [];
    const sameExports = [...exportNames(headBlobs.get(file) ?? "")]
      .filter((name) => byExport.has(name))
      .sort()
      .map((name) => ({ name, base: byExport.get(name) }));
    if (sameName.length > 0 || sameExports.length > 0) {
      items.push({ path: file, sameName, sameExports });
    }
  }
  return items;
}

// ---------------------------------------------------------------- 報告

const code = (text) =>
  text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
const codeList = (files) => files.map(code).join("、");

function section(title, items, render) {
  return [
    `## ${title}(${String(items.length)})`,
    "",
    ...(items.length === 0 ? ["無。"] : items.map(render)),
    "",
  ];
}

/** 報告頁尾的限制(逐節的漏報 / 誤報範圍;正本同 docs/deployment.md 升級後檢查)。 */
const LIMITATIONS = [
  "限制:第 1 節不列專案與混合路徑(混合路徑以 inspect 的 mixed 清單逐段核對)。",
  "第 2 節只認 page-replacements、help project/replacements/ 與專案 forms 的 options / pageOverrides;讀不懂的寫法照列為無法解析。",
  "第 3 節是靜態掃描:只認字串、常數、${常數} 樣板、permissionKey() 與 formModuleDeclaration() 推導的 key,其他寫法在專案端列為無法解析、底座端只計數;推導出的 wildcard 與 data_scope_targets 不另比(由模組 key 涵蓋);未被 import 的 revisions 快照不算;讀不出 collection 時只比 key。",
  "第 4 節只比專案 project/ 路徑的程式檔與底座 common 程式檔的檔名(不含 index)與具名匯出(不含 default);內容相同但名稱不同的重複抓不到。",
];

function renderReport(report) {
  const { project, base, adopted, sections, baseUnresolvedSeedKeys } = report;
  const total = Object.values(sections).reduce(
    (sum, items) => sum + items.length,
    0,
  );
  return [
    `# base-sync verify:${project.repository} 對照底座 ${base.tag}`,
    "",
    `- 專案 commit:${code(project.commit)}(只看已提交的 HEAD)`,
    `- 底座:${base.repository} ${base.tag} → ${code(base.commit)}`,
    `- 採用記錄(package.json wowgoBase):${adopted.tag} → ${code(adopted.commit)}`,
    `- 結果:${
      total === 0
        ? "已去除重複(四節皆為 0)"
        : `尚有 ${String(total)} 項待判讀;逐項說明是真正的專案客製或要回收 / 刪除`
    }`,
    "",
    ...section(
      `1. 非專案、非混合路徑與底座 ${base.tag} 仍不同`,
      sections.baseDifferences,
      (item) => `- ${item.category} ${item.status} ${code(item.path)}`,
    ),
    ...section("2. 客製替換登記", sections.customizations, (item) => {
      const key = item.key === null ? "" : ` ${code(item.key)}`;
      const note = item.note === null ? "" : `:${item.note}`;
      return `- ${item.kind}${key}(${code(item.path)})${note}`;
    }),
    ...section(
      "3. 底座 seed 與專案 seed 同 collection + key",
      sections.seedKeys,
      (item) =>
        item.kind === "duplicate"
          ? `- ${item.collection} ${code(item.key)}:底座 ${codeList(item.base)};專案 ${codeList(item.project)}`
          : `- 無法解析的 key ${code(item.expression)}(${code(item.path)})`,
    ).toSpliced(
      -1,
      0,
      ...(baseUnresolvedSeedKeys > 0
        ? [
            "",
            `底座 seed 另有 ${String(baseUnresolvedSeedKeys)} 個 key 無法靜態解析,未列入比對(不計入結果)。`,
          ]
        : []),
    ),
    ...section(
      "4. 專案路徑與底座同名或同匯出名稱",
      sections.nameDuplicates,
      (item) => {
        const details = [
          ...(item.sameName.length > 0
            ? [`同名 ${codeList(item.sameName)}`]
            : []),
          ...item.sameExports.map(
            ({ name, base: files }) =>
              `同匯出 ${code(name)}(${codeList(files)})`,
          ),
        ];
        return `- ${code(item.path)}:${details.join(";")}`;
      },
    ),
    "Figma 稽核與 CI 不在本報告內,仍依 docs/deployment.md 由人執行。",
    "",
    LIMITATIONS.join(""),
    "",
  ].join("\n");
}

function writeOut(target, markdown) {
  const dir = path.dirname(path.resolve(target));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail("--out 的目錄不存在");
  }
  if (existsSync(target) && statSync(target).isDirectory()) {
    fail("--out 不可是目錄");
  }
  try {
    writeFileSync(target, markdown);
  } catch {
    fail("無法寫入 --out");
  }
}

export function verify(options) {
  const { tag } = options;
  if (!isTagName(tag)) fail("--tag 格式不符");
  const root = requireRepositoryRoot(options.project, "--project");
  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const project = loadProject(root, { ref: head, requireUpstream: false });
  const tagObject = resolveRef(root, `${RELEASE_PREFIX}${tag}`);
  if (tagObject === null) {
    fail(
      `${project.label} 沒有 ${RELEASE_PREFIX}${tag};先以 upgrade 取得並核對這個底座版本`,
    );
  }
  const tagCommit = git(root, [
    "rev-parse",
    "--verify",
    `${tagObject}^{commit}`,
  ]);
  if (!isAncestor(root, tagCommit, head)) {
    fail(
      `${project.label} 的 HEAD 尚未包含底座 ${tag};先提交升級 merge 再執行 verify`,
    );
  }

  const headFiles = listTree(root, head);
  const baseFiles = listTree(root, tagCommit);
  const baseCode = baseFiles.filter(
    (file) => CODE_FILE.test(file) && classifyPath(file, "A") === "common",
  );
  const projectCode = headFiles.filter(isProjectCode);
  const headBlobs = readBlobs(root, head, [
    ...headFiles.filter(
      (file) =>
        file === PAGE_REPLACEMENTS ||
        file === PROJECT_MODULE_PAGES ||
        (file.startsWith(PROJECT_SEEDS) && CODE_FILE.test(file)),
    ),
    ...projectCode,
  ]);
  const baseBlobs = readBlobs(root, tagCommit, [
    ...new Set([
      ...baseFiles.filter(
        (file) => file.startsWith(BASE_SEEDS) && CODE_FILE.test(file),
      ),
      ...baseCode,
    ]),
  ]);

  const seedFindings = seedKeyFindings(baseBlobs, headBlobs);
  const report = {
    project: { repository: project.repository, root, commit: head },
    base: {
      repository: project.adopted.repository,
      tag,
      tagObject,
      commit: tagCommit,
    },
    adopted: project.adopted,
    baseUnresolvedSeedKeys: seedFindings.baseUnresolved,
    sections: {
      baseDifferences: baseDifferences(root, tagCommit, head),
      customizations: customizationItems(headFiles, headBlobs),
      seedKeys: seedFindings.items,
      nameDuplicates: nameDuplicates(
        projectCode,
        headBlobs,
        baseCode,
        baseBlobs,
      ),
    },
  };
  const markdown = renderReport(report);
  if (options.out !== undefined) writeOut(options.out, markdown);
  const isClean = Object.values(report.sections).every(
    (items) => items.length === 0,
  );
  return { markdown, isClean };
}
