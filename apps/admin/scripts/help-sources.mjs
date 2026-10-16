/**
 * 模組說明的三份來源在檔案系統上的樣子(`check-help-bundle.mjs` 與它的測試共用):
 * 哪三個目錄、各有哪些 `<moduleKey>.help.md`,以及「檔案層」就看得出來的問題。
 *
 * 執行期的合成與驗證在 `src/lib/base/module-help.ts` 的 `composeHelpRegistry`(那份吃的是 Vite glob 的產物);
 * 這裡是 build 後、部署前的那一道:碰撞留到瀏覽器才丟錯就太晚了,所以新增撞底座、替換不存在的底座說明
 * 也在這裡擋。目錄的對應要與 `src/lib/base/help-registry.ts` 的三個 glob 一致。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const HELP_SUFFIX = ".help.md";

/**
 * 三份來源(`segments` 相對於 `src/md/module-help/`)。專案的兩個目錄可以不存在或是空的;
 * 底座一定要有檔案(整個目錄被 .dockerignore 排掉時就是 0 份)。
 */
export const HELP_SOURCES = [
  { id: "base", label: "底座", segments: ["base"], isRequired: true },
  {
    id: "additions",
    label: "專案新增",
    segments: ["project", "additions"],
    isRequired: false,
  },
  {
    id: "replacements",
    label: "專案替換",
    segments: ["project", "replacements"],
    isRequired: false,
  },
];

/** 底座一定要有的說明檔:表單模組的通用說明(沒有專屬檔的表單模組都用它)。 */
export const REQUIRED_BASE_HELP_FILES = ["form-module.help.md"];

const toPosix = (path) => path.split(sep).join("/");

/** 目錄不存在回 undefined(與「存在但是空的」分開)。 */
const listDir = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
};

/** `root` 底下所有 `.md`(遞迴),回相對於 `root` 的 posix 路徑。 */
const walkMarkdown = (root, dir = root) =>
  (listDir(dir) ?? []).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkMarkdown(root, path);
    return entry.name.endsWith(".md") ? [toPosix(relative(root, path))] : [];
  });

/**
 * 讀三份來源。回傳:
 * - `files`:每份 `*.help.md`(`source` = 來源 id、`key` = 模組 key、`relativePath`、`content`)
 * - `problems`:檔案層的問題(字串陣列;空 = 沒問題)
 */
export const readHelpSources = (helpRoot) => {
  const problems = [];
  const files = [];
  const sourceDirs = new Set();

  for (const source of HELP_SOURCES) {
    const dir = join(helpRoot, ...source.segments);
    const relativeDir = source.segments.join("/");
    sourceDirs.add(relativeDir);
    const entries = listDir(dir);
    const markdown = (entries ?? [])
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort();

    if (source.isRequired && markdown.length === 0) {
      problems.push(
        entries === undefined
          ? `讀不到${source.label}說明目錄 ${dir} —— 是不是被 .dockerignore 排除了?`
          : `${source.label}說明目錄 ${dir} 一份 .md 都沒有 —— 是不是被 .dockerignore 排除了?`,
      );
    }
    for (const name of markdown) {
      const relativePath = relativeDir === "" ? name : `${relativeDir}/${name}`;
      const key = name.endsWith(HELP_SUFFIX)
        ? name.slice(0, -HELP_SUFFIX.length)
        : "";
      if (key === "") {
        problems.push(
          `${relativePath} 的檔名不是 <moduleKey>${HELP_SUFFIX},不會被收進 bundle(lib/base/help-registry.ts 的 glob 只認這個命名)`,
        );
        continue;
      }
      files.push({
        source: source.id,
        key,
        relativePath,
        content: readFileSync(join(dir, name), "utf8"),
      });
    }
  }

  // 三個來源目錄以外的 .md:glob 收不到,放錯位置的說明會無聲消失
  for (const relativePath of walkMarkdown(helpRoot)) {
    const slash = relativePath.lastIndexOf("/");
    const dir = slash === -1 ? "" : relativePath.slice(0, slash);
    if (!sourceDirs.has(dir)) {
      problems.push(
        `${relativePath} 不在任何說明來源目錄裡(只認 ${HELP_SOURCES.map(
          (source) => `${source.segments.join("/") || "."}/`,
        ).join("、")}),不會被收進 bundle`,
      );
    }
  }

  const keysOf = (id) =>
    new Set(files.filter((file) => file.source === id).map((file) => file.key));
  const baseKeys = keysOf("base");

  const absent = REQUIRED_BASE_HELP_FILES.filter(
    (name) => !baseKeys.has(name.slice(0, -HELP_SUFFIX.length)),
  );
  if (absent.length > 0) {
    problems.push(
      `缺少必要的底座說明檔 ${absent.join("、")} —— 表單模組沒有專屬說明時都靠它`,
    );
  }
  for (const file of files) {
    if (file.source === "additions" && baseKeys.has(file.key)) {
      problems.push(
        `${file.relativePath} 與底座的說明撞 key「${file.key}」—— 要換掉底座的說明請放進 project/replacements/`,
      );
    }
    if (file.source === "replacements" && !baseKeys.has(file.key)) {
      problems.push(
        `${file.relativePath} 要替換的「${file.key}」不是底座的說明 —— 專案新增模組的說明請放進 project/additions/`,
      );
    }
  }

  return { files, problems };
};
