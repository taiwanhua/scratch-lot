import { describe, expect, it } from "@jest/globals";

import { COLLATION_LOCALE, compareDisplayName } from "./compare-display-name";

describe("compareDisplayName:名稱排序固定 zh-Hant", () => {
  it("中文依筆畫排序(王 4、李 7、兩 8、林 8、陳 11)", () => {
    expect(
      ["陳大文", "林新人", "王小明", "兩店都在的人", "李小華"].toSorted(
        compareDisplayName,
      ),
    ).toEqual(["王小明", "李小華", "兩店都在的人", "林新人", "陳大文"]);
  });

  it("中英混排:英文字排在中文之後,英文之間依字母、不因大小寫分群", () => {
    expect(
      ["bob", "王小明", "Amy", "李小華", "Carol"].toSorted(compareDisplayName),
    ).toEqual(["王小明", "李小華", "Amy", "bob", "Carol"]);
  });

  it("相同名稱比較結果為 0", () => {
    expect(compareDisplayName("王小明", "王小明")).toBe(0);
  });

  it("和英文語系(CI / Linux 常見的預設)排出來不同 —— 所以一定要明寫語系", () => {
    const names = ["陳大文", "Amy", "林新人", "王小明", "李小華"];
    const english = new Intl.Collator("en");
    expect(COLLATION_LOCALE).toBe("zh-Hant");
    expect(names.toSorted(compareDisplayName)).not.toEqual(
      names.toSorted((left, right) => english.compare(left, right)),
    );
  });

  it("純 ASCII 的 key 在 zh-Hant 與 en 排出相同順序(統一語系不改變 key 排序)", () => {
    const keys = ["system.users", "Audit-log", "forms_v2", "a10", "a2", "B"];
    const english = new Intl.Collator("en");
    expect(
      keys.toSorted((left, right) =>
        left.localeCompare(right, COLLATION_LOCALE),
      ),
    ).toEqual(keys.toSorted((left, right) => english.compare(left, right)));
  });
});
