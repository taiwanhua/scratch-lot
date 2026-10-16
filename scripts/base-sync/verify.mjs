/**
 * `verify`:唯讀。升級完成(merge 已提交)後,核對專案的改動是否已被新底座包含,產出 Markdown 報告
 * (操作正本:docs/deployment.md「底座首次接軌與版本升級」的升級後檢查)。四節:
 *
 *   1. 共用路徑(common)與新底座 tag 仍不同的檔案:沒回收到或漂移
 *   2. 所有客製替換登記:頁面替換、help 替換、專案表單模組的 options / pageOverrides
 *   3. 同一個 key 同時出現在底座 seed 與專案 seed
 *   4. 專案路徑內與底座同名或同匯出名稱的檔案
 *
 * 「底座」一律取新底座 tag 的 commit,「專案」一律取專案已提交的 HEAD;不讀工作樹、不 fetch、不寫任何 ref。
 * tag 取自 upgrade 存的 `refs/base/releases/<tag>`,且 HEAD 必須已包含它。
 * 第 2–4 節是靜態文字掃描(不執行 TypeScript):讀不懂的登記照樣列出,寧可多列、不漏列;人只判讀例外。
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

function commonDifferences(root, tagCommit, head) {
  return diffFiles(root, tagCommit, head)
    .filter((file) => classifyPath(file.path, file.status) === "common")
    .map(({ path: file, status }) => ({ path: file, status }));
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

const STRING_CONSTANT =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'])([^"'\n\\]*)\2/g;
const KEY_PROPERTY =
  /(?<![\w$.])key\s*:\s*(?:(["'`])([^"'`\n\\]*)\1|([A-Za-z_$][\w$]*)\b(?!\s*[.(\[]))/g;

/** 所在的物件字面值(往回找未配對的左大括號);找不到回 null。 */
function enclosingObject(text, index) {
  let depth = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const char = text[cursor];
    if (char === "}") depth += 1;
    else if (char === "{") {
      if (depth === 0) {
        const close = matchingClose(text, cursor);
        return close === -1 ? null : text.slice(cursor, close + 1);
      }
      depth -= 1;
    }
  }
  return null;
}

/** seed 檔裡的 key 宣告;`{ collection, key }` 形式的引用(關聯、$seedRef)不算宣告。 */
function seedKeys(text, constants) {
  const stripped = stripComments(text);
  const keys = new Set();
  for (const match of stripped.matchAll(KEY_PROPERTY)) {
    const key = match[2] ?? constants.get(match[3]) ?? null;
    if (key === null || key === "") continue;
    const object = enclosingObject(stripped, match.index);
    if (
      object !== null &&
      /\bcollection\s*:/.test(withoutStrings(topLevel(object)))
    ) {
      continue;
    }
    keys.add(key);
  }
  return keys;
}

const isRevision = (file) => file.includes("/revisions/");

/**
 * 一方的 seed 宣告:目前的宣告檔,加上被宣告檔 import 的 revisions 快照(設計器匯出、直接當 seed 用的那種)。
 * 只給 migration 明示套用的歷史快照不算目前宣告(已發布快照不能刪,退場是以新增版本表達)。
 */
function seedDeclarations(blobs, prefix) {
  const files = [...blobs.keys()].filter(
    (file) => file.startsWith(prefix) && CODE_FILE.test(file),
  );
  const current = files.filter((file) => !isRevision(file));
  const currentText = current.map((file) => blobs.get(file)).join("\n");
  const live = files.filter((file) => {
    if (!isRevision(file)) return true;
    const stem = path.posix.basename(file).replace(CODE_FILE, "");
    return currentText.includes(`revisions/${stem}`);
  });
  const constants = new Map();
  for (const file of files) {
    for (const match of stripComments(blobs.get(file)).matchAll(
      STRING_CONSTANT,
    )) {
      constants.set(match[1], match[3]);
    }
  }
  return { live, constants };
}

function seedKeyDuplicates(baseBlobs, headBlobs) {
  const base = seedDeclarations(baseBlobs, BASE_SEEDS);
  const project = seedDeclarations(headBlobs, PROJECT_SEEDS);
  // 專案可 import 底座的常數,解析時兩方的常數都看得到(專案優先)
  const projectConstants = new Map([...base.constants, ...project.constants]);
  const collect = (blobs, files, constants) => {
    const owners = new Map();
    for (const file of files) {
      for (const key of seedKeys(blobs.get(file), constants)) {
        owners.set(key, [...(owners.get(key) ?? []), file]);
      }
    }
    return owners;
  };
  const baseOwners = collect(baseBlobs, base.live, base.constants);
  const projectOwners = collect(headBlobs, project.live, projectConstants);
  return [...projectOwners.keys()]
    .filter((key) => baseOwners.has(key))
    .sort()
    .map((key) => ({
      key,
      base: baseOwners.get(key),
      project: projectOwners.get(key),
    }));
}

// ---------------------------------------------------------------- 第 4 節

const EXPORT_DECLARATION =
  /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;

/** 檔案的具名匯出(不含 default)。 */
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

function renderReport(report) {
  const { project, base, adopted, sections } = report;
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
      `1. 共用路徑與底座 ${base.tag} 仍不同`,
      sections.commonDifferences,
      (item) => `- ${item.status} ${code(item.path)}`,
    ),
    ...section("2. 客製替換登記", sections.customizations, (item) => {
      const key = item.key === null ? "" : ` ${code(item.key)}`;
      const note = item.note === null ? "" : `:${item.note}`;
      return `- ${item.kind}${key}(${code(item.path)})${note}`;
    }),
    ...section(
      "3. 底座 seed 與專案 seed 同 key",
      sections.seedKeyDuplicates,
      (item) =>
        `- ${code(item.key)}:底座 ${codeList(item.base)};專案 ${codeList(item.project)}`,
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

  const report = {
    project: { repository: project.repository, root, commit: head },
    base: {
      repository: project.adopted.repository,
      tag,
      tagObject,
      commit: tagCommit,
    },
    adopted: project.adopted,
    sections: {
      commonDifferences: commonDifferences(root, tagCommit, head),
      customizations: customizationItems(headFiles, headBlobs),
      seedKeyDuplicates: seedKeyDuplicates(baseBlobs, headBlobs),
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
