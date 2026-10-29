import { describe, expect, it } from "@jest/globals";

import {
  FIELD_INITIAL_SEED_VALUE_FIELDS,
  fields,
  globalFieldOptions,
} from "./fields";

describe("全域欄位選項的宣告", () => {
  it("`enabled` 與 `color` 是初始 seed 值:人在欄位管理改過的,重跑 seed 不覆蓋", () => {
    expect(fields.initialSeedValueFields).toEqual([
      ...FIELD_INITIAL_SEED_VALUE_FIELDS,
    ]);
    expect(FIELD_INITIAL_SEED_VALUE_FIELDS).toEqual(["enabled", "color"]);
  });

  it("有宣告顏色的才帶 `color`;沒宣告的不帶這一欄", () => {
    const [colored, plain] = globalFieldOptions("demo-kind", [
      { value: "first", label: "第一", color: "green" },
      { value: "second", label: "第二" },
    ]);
    expect(colored?.key).toBe("demo-kind.first");
    expect(colored?.data).toMatchObject({
      value: "first",
      order: 1,
      color: "green",
    });
    expect(plain?.data).toMatchObject({ value: "second", order: 2 });
    expect(plain?.data).not.toHaveProperty("color");
  });
});
