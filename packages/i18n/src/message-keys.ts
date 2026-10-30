import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * 字典測試共用的讀檔工具(只給 `*.test.ts` 用,不從 `index.ts` 匯出)。
 * 直接讀 `messages/` 底下的檔案而不是 `index.ts` 的 `messages`:新增一份字典卻忘了掛進
 * `index.ts` 時,測試也要看得到它。
 */

export const MESSAGES_DIR = path.resolve(__dirname, "..", "messages");

/** `messages/<locale>/` 的語系資料夾名(依字母排序,斷言訊息穩定)。 */
export const localeDirs = (): string[] =>
  readdirSync(MESSAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted((a, b) => a.localeCompare(b, "zh-Hant"));

/** 某語系底下的字典檔名(不含副檔名,即 namespace:`admin` / `front` / `common`)。 */
export const namespacesOf = (locale: string): string[] =>
  readdirSync(path.join(MESSAGES_DIR, locale))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .toSorted((a, b) => a.localeCompare(b, "zh-Hant"));

/**
 * 某語系的專案文案檔名(`messages/<locale>/project/*.json`,不含副檔名:`admin` / `admin.replacements`);
 * 沒有 project/ 資料夾回空陣列。
 */
export const projectFilesOf = (locale: string): string[] => {
  const dir = path.join(MESSAGES_DIR, locale, "project");
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .toSorted((a, b) => a.localeCompare(b, "zh-Hant"));
};

/** 讀一份專案文案檔(`project/<name>.json`)的原始內容。 */
export const readProjectFile = (locale: string, name: string): unknown =>
  JSON.parse(
    readFileSync(
      path.join(MESSAGES_DIR, locale, "project", `${name}.json`),
      "utf8",
    ),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface DictionaryKeys {
  /** 葉節點(真正的一句文案)的完整路徑,如 `admin.userManager.actions.edit`。 */
  leaves: Set<string>;
  /** 中間節點的完整路徑(可當 `useTranslations` 的 namespace),含頂層 `admin`。 */
  branches: Set<string>;
}

/** 把一份已在記憶體裡的字典攤平成完整路徑;路徑以 namespace 開頭(與 `useTranslations` 的寫法一致)。 */
export const flattenKeys = (
  raw: unknown,
  namespace: string,
): DictionaryKeys => {
  const leaves = new Set<string>();
  const branches = new Set<string>([namespace]);
  const walk = (node: unknown, prefix: string): void => {
    if (!isRecord(node)) {
      leaves.add(prefix);
      return;
    }
    if (prefix !== namespace) {
      branches.add(prefix);
    }
    for (const [key, value] of Object.entries(node)) {
      walk(value, `${prefix}.${key}`);
    }
  };
  walk(raw, namespace);
  return { leaves, branches };
};

/** 讀一份字典檔,攤平成完整路徑。 */
export const keysOf = (locale: string, namespace: string): DictionaryKeys => {
  const raw: unknown = JSON.parse(
    readFileSync(path.join(MESSAGES_DIR, locale, `${namespace}.json`), "utf8"),
  );
  return flattenKeys(raw, namespace);
};

/** 一個語系的完整字典(`{ common, front, admin }`)→ 葉節點路徑對文案;順序即字典的鍵順序。 */
export const leafValuesOf = (dictionary: unknown): Map<string, string> => {
  const values = new Map<string, string>();
  const walk = (node: unknown, prefix: string): void => {
    if (!isRecord(node)) {
      values.set(prefix, String(node));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      walk(value, prefix === "" ? key : `${prefix}.${key}`);
    }
  };
  walk(dictionary, "");
  return values;
};

export { icuArgumentsOf } from "./icu-arguments";
