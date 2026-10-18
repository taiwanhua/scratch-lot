import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import * as ts from "typescript";

/**
 * 死鍵測試的靜態掃描(只給 `dead-keys.test.ts` 用)。做法寫在這裡,測試檔只放白名單。
 *
 * ## 掃什麼
 *
 * 呼叫端的 `src/**` 底下所有 `.ts` / `.tsx`,**排除**測試(`*.test.*`、`test/` 資料夾)與 story ——
 * 只在測試裡被引用的鍵,畫面上一樣看不到,仍然算死鍵。用 TypeScript 的 parser 取節點,
 * 不用 regex(註解裡的引號、跳脫字元都不會誤判)。
 *
 * ## 每個檔案收集三樣東西
 *
 * 1. **字面字串**:所有 `"..."` 與不含 `${}` 的 template(`t("actions.edit")`、設定物件裡的
 *    `labelKey: "name"` 都算 —— 鍵常常先寫在設定表、再交給 `t`)
 * 2. **namespace**:`useTranslations("<ns>")` / `getTranslations("<ns>")` /
 *    `getTranslations({ namespace: "<ns>" })` 的字串參數
 * 3. **「當值傳遞」的 namespace**:
 *    - 值剛好等於字典某個中間節點的字面字串(`SAMPLE_ONE_I18N = "admin.demoSampleOne"`、
 *      `namespace="admin.roleManager.discard"`),全 repo 共用,稱為 root
 *    - 形如 `` `${x}.form` `` 的 template(`useTranslations(`${i18nNamespace}.form`)`、
 *      `namespace={`${i18nNamespace}.discard`}`)→ 每個 root 接上 `.form` 後若是中間節點就算
 *    - `useTranslations(namespace)` 這種參數是變數的 → 視為「任何 root」
 *
 * ## 判定
 *
 * 字面字串 `L` 與 namespace `N` 組成 `N.L`,是字典的葉節點就算「有引用」;`L` 本身就是完整路徑也算。
 * 配對範圍是**檔案所在資料夾(含子資料夾)**:頁面常把 `t` 開在元件、把鍵寫在同資料夾的
 * 設定檔(`UserTable/` 的欄位表)。`src/` 根目錄的檔案只跟自己配對,否則等於全 repo 互配。
 *
 * ## 掃不到的(交給白名單)
 *
 * **鍵由執行期的值組出來**的一律掃不到:`` t(`errors.${code}`) ``、`tConditions(cond)`、
 * 圖示短詞 `tIcons(key)`。這類在 `dead-keys.test.ts` 的 `DYNAMIC_KEYS` 逐條列出並寫理由;
 * 白名單本身也會被檢查(每一條至少要對得上一個鍵,鍵刪光了白名單就要跟著刪)。
 */

const TRANSLATION_FACTORIES = new Set(["useTranslations", "getTranslations"]);

interface FileUsage {
  file: string;
  literals: Set<string>;
  namespaces: Set<string>;
  /** `` `${x}.form` `` 的 `.form`;參數是變數時為 `""`(任何 root) */
  namespaceSuffixes: Set<string>;
  /** 字面上就是中間節點、且不是直接寫在 `useTranslations(...)` 裡的字串 */
  valueNamespaces: string[];
}

const sourceFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "test" || entry.name === "node_modules"
        ? []
        : sourceFilesUnder(full);
    }
    return /\.tsx?$/.test(entry.name) &&
      !/\.(test|stories)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
      ? [full]
      : [];
  });

/** `useTranslations` 的第一個參數(`getTranslations({ namespace })` 取物件裡的那一格)。 */
const namespaceArgumentOf = (
  call: ts.CallExpression,
): ts.Expression | undefined => {
  const [first] = call.arguments;
  if (first !== undefined && ts.isObjectLiteralExpression(first)) {
    const property = first.properties.find(
      (candidate): candidate is ts.PropertyAssignment =>
        ts.isPropertyAssignment(candidate) &&
        ts.isIdentifier(candidate.name) &&
        candidate.name.text === "namespace",
    );
    return property?.initializer;
  }
  return first;
};

const isPlainString = (
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

const usageOf = (file: string, branches: ReadonlySet<string>): FileUsage => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const literals = new Set<string>();
  const namespaces = new Set<string>();
  const namespaceSuffixes = new Set<string>();
  const factoryArguments = new Set<ts.Node>();

  const visit = (node: ts.Node): void => {
    if (isPlainString(node)) {
      literals.add(node.text);
    }
    if (
      ts.isTemplateExpression(node) &&
      node.head.text === "" &&
      node.templateSpans.length === 1 &&
      node.templateSpans[0]?.literal.text.startsWith(".") === true
    ) {
      namespaceSuffixes.add(node.templateSpans[0].literal.text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      TRANSLATION_FACTORIES.has(node.expression.text)
    ) {
      const argument = namespaceArgumentOf(node);
      if (argument === undefined) {
        namespaces.add("");
      } else if (isPlainString(argument)) {
        namespaces.add(argument.text);
        factoryArguments.add(argument);
      } else if (
        ts.isIdentifier(argument) ||
        ts.isPropertyAccessExpression(argument)
      ) {
        namespaceSuffixes.add("");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const factoryTexts = new Set(
    [...factoryArguments].map((node) => (node as ts.StringLiteral).text),
  );
  return {
    file,
    literals,
    namespaces,
    namespaceSuffixes,
    valueNamespaces: [...literals].filter(
      (literal) => branches.has(literal) && !factoryTexts.has(literal),
    ),
  };
};

/**
 * 全 repo 共用的 root:字面上就是中間節點的值,再接上各處 `` `${x}.suffix` `` 的後綴
 * (Set 在迭代中新增的元素也會被走到,所以 `.a` 再接 `.b` 這種兩層也收得到)。
 */
const collectRoots = (
  usages: readonly FileUsage[],
  branches: ReadonlySet<string>,
): Set<string> => {
  const roots = new Set(usages.flatMap((usage) => usage.valueNamespaces));
  const suffixes = new Set(
    usages.flatMap((usage) =>
      [...usage.namespaceSuffixes].filter((suffix) => suffix !== ""),
    ),
  );
  for (const root of roots) {
    for (const suffix of suffixes) {
      if (branches.has(root + suffix)) {
        roots.add(root + suffix);
      }
    }
  }
  return roots;
};

/** 配對範圍裡可用的 namespace:直接寫的、當值傳進來的、`${x}.suffix` 接出來的。 */
const namespacesInScope = (
  scope: readonly FileUsage[],
  roots: ReadonlySet<string>,
  branches: ReadonlySet<string>,
): Set<string> => {
  const namespaces = new Set<string>();
  for (const member of scope) {
    for (const namespace of [...member.namespaces, ...member.valueNamespaces]) {
      namespaces.add(namespace);
    }
    for (const suffix of member.namespaceSuffixes) {
      const candidates = [...roots].map((root) => root + suffix);
      for (const candidate of candidates) {
        if (suffix === "" || branches.has(candidate)) {
          namespaces.add(candidate);
        }
      }
    }
  }
  return namespaces;
};

/** 檔案所在資料夾(含子資料夾)的所有檔案;`src/` 根目錄的檔案只有自己。 */
const scopeOf = (
  usage: FileUsage,
  usages: readonly FileUsage[],
  sourceRoots: ReadonlySet<string>,
): FileUsage[] => {
  const dir = path.dirname(usage.file);
  return sourceRoots.has(path.resolve(dir))
    ? [usage]
    : usages.filter((other) => other.file.startsWith(dir + path.sep));
};

/**
 * 掃描 `sourceRoots` 底下的程式碼,回傳**有被引用到**的葉節點鍵。
 * `leaves` / `branches` 是全部字典攤平後的完整路徑(`admin.xxx` / `front.xxx` / `common.xxx`)。
 */
export const referencedKeys = (
  sourceRoots: readonly string[],
  leaves: ReadonlySet<string>,
  branches: ReadonlySet<string>,
): Set<string> => {
  const usages = sourceRoots.flatMap((root) =>
    sourceFilesUnder(root).map((file) => usageOf(file, branches)),
  );
  const roots = collectRoots(usages, branches);
  const normalizedRoots = new Set(
    sourceRoots.map((root) => path.resolve(root)),
  );

  const referenced = new Set<string>();
  for (const usage of usages) {
    const namespaces = namespacesInScope(
      scopeOf(usage, usages, normalizedRoots),
      roots,
      branches,
    );
    const candidates = [...usage.literals].flatMap((literal) => [
      literal,
      ...[...namespaces].map((namespace) =>
        namespace === "" ? literal : `${namespace}.${literal}`,
      ),
    ]);
    for (const key of candidates) {
      if (leaves.has(key)) {
        referenced.add(key);
      }
    }
  }
  return referenced;
};
