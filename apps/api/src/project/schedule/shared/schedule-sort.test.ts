import { describe, expect, it } from "@jest/globals";

import { SCHEDULE_SORT_LOCALE, compareScheduleNames } from "./schedule-sort";

const NAMES = ["陳大文", "Amy", "兩店都在的人", "林新人", "王小明", "李小華"];
/** zh-Hant 依筆畫:王 4、李 7、兩 8、林 8、陳 11;英文字排在中文之後。 */
const EXPECTED = [
  "王小明",
  "李小華",
  "兩店都在的人",
  "林新人",
  "陳大文",
  "Amy",
];

describe("排班的姓名排序明寫 zh-Hant,不受執行環境預設語系影響", () => {
  it("依筆畫排序(固定結果)", () => {
    expect(SCHEDULE_SORT_LOCALE).toBe("zh-Hant");
    expect(NAMES.toSorted(compareScheduleNames)).toEqual(EXPECTED);
  });

  it("和英文語系(Linux 上的 Cloud Run / CI 常見的預設)排出來的不同 —— 所以一定要明寫語系", () => {
    const collator = new Intl.Collator("en");
    const english = (left: string, right: string) =>
      collator.compare(left, right);
    expect(NAMES.toSorted(english)).toEqual([
      "Amy",
      "兩店都在的人",
      "李小華",
      "林新人",
      "王小明",
      "陳大文",
    ]);
    expect(NAMES.toSorted(compareScheduleNames)).not.toEqual(
      NAMES.toSorted(english),
    );
  });
});
