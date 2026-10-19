/**
 * ICU 文案的參數名解析(純函式,不讀檔):專案替換底座字串時,執行期以它確認參數名一致(I18N-06);
 * 字典測試也用同一份(`message-keys.ts` 轉出)。
 */

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
