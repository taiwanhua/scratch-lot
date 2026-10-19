import { readFileSync, readdirSync } from "node:fs";
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
    .toSorted((a, b) => a.localeCompare(b));

/** 某語系底下的字典檔名(不含副檔名,即 namespace:`admin` / `front` / `common`)。 */
export const namespacesOf = (locale: string): string[] =>
  readdirSync(path.join(MESSAGES_DIR, locale))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .toSorted((a, b) => a.localeCompare(b));

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

const ARGUMENT_NAME = /^[A-Za-z_]\w*$/;

/**
 * 一句文案用到的 ICU 參數名(去重、排序)。只認 `{name}` / `{name, type, …}` 的 name;
 * plural / select 的分支文字(`one {# item}`)會往內再找參數,但分支文字本身不算。
 * 單引號照 ICU 的規則:`''` 是一個單引號;`'` 後面緊接 `{` `}` `<` `>` 開啟引號
 * (緊貼在 plural / selectordinal 分支裡時 `'#` 也算),到下一個落單的 `'` 為止整段都是文字
 * (裡面的 `{…}` 不算參數);其餘的 `'` 就是文字。最外層落單的 `}` 也是文字,不會結束整句。
 */
export const icuArgumentsOf = (message: string): string[] => {
  const names = new Set<string>();
  // `index` 指著一個 `'`:回傳這段跳脫 / 引號 / 單純文字之後的位置
  const skipApostrophe = (index: number, inPlural: boolean): number => {
    const next = message.charAt(index + 1);
    if (next === "'") {
      return index + 2;
    }
    const opensQuote =
      next !== "" && ("{}<>".includes(next) || (inPlural && next === "#"));
    if (!opensQuote) {
      return index + 1;
    }
    let cursor = index + 2;
    while (cursor < message.length) {
      if (message.charAt(cursor) !== "'") {
        cursor += 1;
      } else if (message.charAt(cursor + 1) === "'") {
        cursor += 2;
      } else {
        return cursor + 1;
      }
    }
    return cursor;
  };
  // 從 `{` 的下一個字元讀一個參數,回傳對應 `}` 之後的位置
  const readArgument = (start: number): number => {
    let index = start;
    while (index < message.length && !",}".includes(message.charAt(index))) {
      index += 1;
    }
    const name = message.slice(start, index).trim();
    if (ARGUMENT_NAME.test(name)) {
      names.add(name);
    }
    // 型別(`plural` / `select` / `number` …):決定分支裡的 `#` 是不是特殊字元
    let typeEnd = index + 1;
    while (
      typeEnd < message.length &&
      !",}".includes(message.charAt(typeEnd))
    ) {
      typeEnd += 1;
    }
    const type = message.slice(index + 1, typeEnd).trim();
    const isPlural = type === "plural" || type === "selectordinal";
    // 參數的其餘部分(型別、樣式、分支):分支的 `{…}` 是另一句文案,往內找參數
    while (index < message.length && message.charAt(index) !== "}") {
      index =
        message.charAt(index) === "{"
          ? readMessage(index + 1, true, isPlural)
          : index + 1;
    }
    return index + 1;
  };
  // 讀一句文案:分支(`nested`)讀到它所屬的 `}` 為止並回傳 `}` 之後的位置;
  // 最外層一路讀到結尾,途中落單的 `}` 是文字
  const readMessage = (
    start: number,
    nested: boolean,
    inPlural: boolean,
  ): number => {
    let index = start;
    while (index < message.length) {
      const char = message.charAt(index);
      if (char === "}" && nested) {
        break;
      }
      if (char === "'") {
        index = skipApostrophe(index, inPlural);
      } else {
        index = char === "{" ? readArgument(index + 1) : index + 1;
      }
    }
    return index + 1;
  };
  readMessage(0, false, false);
  return [...names].toSorted((a, b) => a.localeCompare(b, "zh-Hant"));
};
