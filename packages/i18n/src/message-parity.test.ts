import { describe, expect, it } from "@jest/globals";

import { defaultLocale, locales } from ".";
import { keysOf, localeDirs, namespacesOf } from "./message-keys";

/**
 * I18N-02「新增 key 必須同時補齊所有語言」的守門:每個語系的字典檔一樣多、
 * 每份字典的鍵集合(葉節點 + 巢狀結構)完全一致。以預設語系為基準,差集直接印在失敗訊息裡。
 */
describe("字典的語系一致性(I18N-02)", () => {
  it("messages/ 底下的語系資料夾就是 `locales` 宣告的那幾個", () => {
    expect(localeDirs()).toEqual(
      [...locales].toSorted((a, b) => a.localeCompare(b)),
    );
  });

  const namespaces = namespacesOf(defaultLocale);
  const otherLocales = locales.filter((locale) => locale !== defaultLocale);

  it.each(otherLocales)("%s 的字典檔與預設語系同一組", (locale) => {
    expect(namespacesOf(locale)).toEqual(namespaces);
  });

  describe.each(otherLocales)("%s 與預設語系的鍵集合", (locale) => {
    it.each(namespaces)("%s.json 的鍵完全一致", (namespace) => {
      const base = keysOf(defaultLocale, namespace);
      const other = keysOf(locale, namespace);

      // 分兩個方向斷言,失敗訊息才看得出是「少了」還是「多了」
      expect({
        missing: [...base.leaves].filter((key) => !other.leaves.has(key)),
        extra: [...other.leaves].filter((key) => !base.leaves.has(key)),
      }).toEqual({ missing: [], extra: [] });
      expect(
        [...other.branches].toSorted((a, b) => a.localeCompare(b)),
      ).toEqual([...base.branches].toSorted((a, b) => a.localeCompare(b)));
    });
  });
});
