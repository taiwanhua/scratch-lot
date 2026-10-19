import { icuArgumentsOf } from "./icu-arguments";

/**
 * 專案後台文案併進底座 `admin` 字典(I18N-06):`messages/<locale>/project/admin.json` 新增專案自己的鍵,
 * `project/admin.replacements.json` 替換底座既有的字串,與 help 的 `project/additions/`、`project/replacements/`
 * 同一種分法。兩份都是專案維護,底座升級不覆寫;合併後才是 app 拿到的 `admin` namespace。
 *
 * 載入即檢查,不合規則就丟錯(admin 起不來、字典測試紅),不靠載入順序悄悄覆蓋:
 * - 新增:不可與底座撞 key(同一路徑底座已有字串或分支都算),只能往底座沒有的路徑加
 * - 替換:只能換底座已有的字串;ICU 參數名必須與底座那一句相同,否則呼叫端傳的參數對不上、畫面丟 IntlError
 * - 替換不碰專案新增的鍵(那份直接改 `project/admin.json`)
 */

type MessageTree = Readonly<Record<string, unknown>>;

const isTree = (value: unknown): value is MessageTree =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface AdminMessageSources<B, A> {
  /** 錯誤訊息用的語系名 */
  locale: string;
  /** 底座的 `admin.json` */
  base: B;
  /** 專案新增:`project/admin.json` */
  additions: A;
  /** 專案替換:`project/admin.replacements.json`(只能有底座已有的字串鍵) */
  replacements: unknown;
}

const fail = (locale: string, message: string): never => {
  throw new Error(`專案後台文案(${locale})不合規則:${message}`);
};

const childPath = (prefix: string, key: string): string =>
  prefix === "" ? key : `${prefix}.${key}`;

/** 錯誤訊息裡的完整鍵名(`admin.<路徑>`)。 */
const keyName = (path: string): string =>
  path === "" ? "admin" : `admin.${path}`;

const mergeAdditions = (
  locale: string,
  base: MessageTree,
  additions: unknown,
  prefix: string,
): MessageTree => {
  if (!isTree(additions)) {
    return fail(locale, `${keyName(prefix)} 必須是物件`);
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(additions)) {
    merged[key] = mergeAddition(
      locale,
      base[key],
      value,
      childPath(prefix, key),
    );
  }
  return merged;
};

const mergeAddition = (
  locale: string,
  existing: unknown,
  value: unknown,
  path: string,
): unknown => {
  if (existing === undefined) {
    if (isTree(value)) {
      return mergeAdditions(locale, {}, value, path);
    }
    return typeof value === "string"
      ? value
      : fail(locale, `新增的 ${keyName(path)} 必須是字串或物件`);
  }
  if (isTree(existing) && isTree(value)) {
    return mergeAdditions(locale, existing, value, path);
  }
  return fail(
    locale,
    `新增的 ${keyName(path)} 與底座撞 key;要改底座的字串請寫進 project/admin.replacements.json`,
  );
};

const applyReplacements = (
  locale: string,
  base: MessageTree,
  replacements: unknown,
  prefix: string,
): MessageTree => {
  if (!isTree(replacements)) {
    return fail(locale, `替換的 ${keyName(prefix)} 必須是物件`);
  }
  const replaced: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(replacements)) {
    replaced[key] = applyReplacement(
      locale,
      base[key],
      value,
      childPath(prefix, key),
    );
  }
  return replaced;
};

const applyReplacement = (
  locale: string,
  existing: unknown,
  value: unknown,
  path: string,
): unknown => {
  if (existing === undefined) {
    return fail(
      locale,
      `替換的 ${keyName(path)} 不在底座字典裡(新增的鍵寫進 project/admin.json)`,
    );
  }
  if (isTree(existing)) {
    return applyReplacements(locale, existing, value, path);
  }
  if (typeof value !== "string" || typeof existing !== "string") {
    return fail(locale, `替換的 ${keyName(path)} 必須是字串`);
  }
  const expected = icuArgumentsOf(existing).join(", ");
  const actual = icuArgumentsOf(value).join(", ");
  if (expected !== actual) {
    fail(
      locale,
      `替換的 ${keyName(path)} 參數名與底座不同(底座:${expected || "無"};替換:${actual || "無"})`,
    );
  }
  return value;
};

/**
 * 底座 `admin` + 專案新增 + 專案替換 → app 用的 `admin` 字典。不修改傳入的物件。
 * 替換只比對底座字典(先替換再併新增),所以替換檔裡出現專案新增的鍵也會被擋下。
 */
export const composeAdminMessages = <B extends object, A extends object>({
  locale,
  base,
  additions,
  replacements,
}: AdminMessageSources<B, A>): B & A => {
  const replaced = applyReplacements(
    locale,
    base as MessageTree,
    replacements,
    "",
  );
  return mergeAdditions(locale, replaced, additions, "") as B & A;
};
