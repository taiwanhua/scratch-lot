/**
 * 把一份 `SeedSet` 輸出成可直接納入 repo 的 TypeScript 原始碼:
 *
 * ```ts
 * import type { SeedSet } from "@repo/domain/seed";
 *
 * // prettier-ignore
 * export const seed = { … } satisfies SeedSet;
 * ```
 *
 * 匯出的檔案不必再處理就能通過 repo 的 `format:check` 與 lint(不重排的標記、必要時的檔名規則豁免都在檔案裡)。
 * 匯出檔本身就是專案 seed 正本(登記檔 import 這個具名 `seed`),不是另一份待轉抄的 JSON。
 * 名稱、說明、公式、changelog 一律以 JSON 字串字面值輸出(雙引號 + 跳脫),不組成模板字串或可執行片段;
 * 物件鍵不是合法識別字就加引號,`__proto__` 改用計算鍵(否則會變成設定原型)。
 */
import {
  SeedSerializationError,
  assertPureSeedData,
  isPlainRecord,
  joinSeedPath,
} from "./canonical";
import { type SeedSet, isDefinitionSeedSet } from "./declaration";

const INDENT = "  ";

/**
 * 匯出檔是不可變快照:加上 prettier-ignore,檔案放進 repo 後 `pnpm format` 不會重排它,
 * 所以匯出的位元組就是進版控的位元組(同一份宣告再匯出一次,內容完全相同)。
 */
const SNAPSHOT_NOTE = "// 匯出的種子快照:不要手改內容或重新排版。";
const PRETTIER_IGNORE = "// prettier-ignore";

/**
 * 定義匯出檔的檔名固定為 `<key>.<revision>.seed.ts`,而表單 / 流程 key 是底線格式,與 repo 的 kebab-case
 * 檔名規則衝突。豁免照 STRUCT-05 寫在檔案第一行(附原因與到期條件),匯出檔放進 repo 就能過 lint;
 * key 沒有底線時檔名本來就合規,不加(沒用到的豁免本身也是 lint 警告)。
 */
const FILENAME_CASE_EXEMPTION =
  "/* eslint-disable unicorn/filename-case -- 定義快照的檔名固定為 <key>.<revision>.seed.ts,表單 / 流程 key 是底線格式;到期條件:匯出檔名規則或 key 格式改變時移除 */";

function needsFilenameExemption(set: SeedSet): boolean {
  return isDefinitionSeedSet(set) && set.key.includes("_");
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * JSON.stringify 不跳脫、但放進原始碼有風險的字元:行分隔(U+2028 / U+2029)、BOM 與雙向控制字元
 * (審查時看到的順序與實際不同)。一律改寫成四位十六進位的 Unicode 跳脫。
 * 以碼位範圍列出,本檔自己不夾帶這些字元。
 */
const UNSAFE_CODE_POINT_RANGES: readonly (readonly [number, number])[] = [
  [0x20_0e, 0x20_0f],
  [0x20_28, 0x20_2e],
  [0x20_66, 0x20_69],
  [0xfe_ff, 0xfe_ff],
];

const BACKSLASH = String.fromCodePoint(0x5c);

function isUnsafeSourceCodePoint(codePoint: number): boolean {
  return UNSAFE_CODE_POINT_RANGES.some(
    ([from, to]) => codePoint >= from && codePoint <= to,
  );
}

/** 定義宣告的頂層鍵固定順序(其餘種類照宣告順序);沒列到的鍵接在後面。 */
const TOP_LEVEL_KEY_ORDER: readonly string[] = [
  "kind",
  "key",
  "revision",
  "name",
  "changelog",
  "desiredStatus",
  "moduleKey",
  "tabLabelTemplate",
  "allowDraft",
  "serial",
  "voidReasonCategoryKey",
  "checkFormKey",
  "collection",
  "keyField",
  "initialSeedValueFields",
  "match",
  "adoptBy",
  "orgKey",
  "roleKey",
];

function stringLiteral(value: string): string {
  let literal = "";
  for (const character of JSON.stringify(value)) {
    const codePoint = character.codePointAt(0) ?? 0;
    literal += isUnsafeSourceCodePoint(codePoint)
      ? `${BACKSLASH}u${codePoint.toString(16).padStart(4, "0").toUpperCase()}`
      : character;
  }
  return literal;
}

function keyLiteral(key: string): string {
  if (key === "__proto__") {
    return `[${stringLiteral(key)}]`;
  }
  return IDENTIFIER.test(key) ? key : stringLiteral(key);
}

function rank(key: string): number {
  const index = TOP_LEVEL_KEY_ORDER.indexOf(key);
  return index === -1 ? TOP_LEVEL_KEY_ORDER.length : index;
}

function orderedKeysOf(
  record: Record<string, unknown>,
  isTopLevel: boolean,
): string[] {
  const keys = Object.keys(record).filter((key) => record[key] !== undefined);
  if (!isTopLevel) {
    return keys;
  }
  return keys
    .map((key, position) => ({ key, position }))
    .toSorted(
      (left, right) =>
        rank(left.key) - rank(right.key) || left.position - right.position,
    )
    .map(({ key }) => key);
}

function literalOf(value: unknown, path: string, depth: number): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return stringLiteral(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SeedSerializationError(path, "數字必須是有限值");
    }
    return JSON.stringify(value);
  }
  const inner = INDENT.repeat(depth + 1);
  const outer = INDENT.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const items = value.map(
      (item, index) =>
        `${inner}${literalOf(item, joinSeedPath(path, index), depth + 1)},`,
    );
    return `[\n${items.join("\n")}\n${outer}]`;
  }
  if (isPlainRecord(value)) {
    const keys = orderedKeysOf(value, depth === 0);
    if (keys.length === 0) {
      return "{}";
    }
    const properties = keys.map(
      (key) =>
        `${inner}${keyLiteral(key)}: ${literalOf(value[key], joinSeedPath(path, key), depth + 1)},`,
    );
    return `{\n${properties.join("\n")}\n${outer}}`;
  }
  throw new SeedSerializationError(
    path,
    `不是純 JSON 值(${value === undefined ? "undefined" : typeof value}),無法匯出`,
  );
}

/**
 * 匯出 `.ts` 原始碼。只收純 JSON 值(字串、有限數字、布林、null、陣列、純物件;seedRef 也是純物件);
 * 遇到其他值(`ObjectId`、`Date`、函式、accessor、陣列空洞或 `undefined` 元素、循環引用…)
 * 丟 `SeedSerializationError` 並指出位置。
 */
export function serializeSeedSet(set: SeedSet): string {
  // 讀任何值之前先過純資料邊界:accessor、陣列空洞、循環引用在這裡就被擋下並指出位置
  assertPureSeedData(set);
  return [
    ...(needsFilenameExemption(set) ? [FILENAME_CASE_EXEMPTION] : []),
    `import type { SeedSet } from "@repo/domain/seed";`,
    "",
    SNAPSHOT_NOTE,
    PRETTIER_IGNORE,
    `export const seed = ${literalOf(set, "", 0)} satisfies SeedSet;`,
    "",
  ].join("\n");
}
