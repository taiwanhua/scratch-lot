import { describe, expect, it } from "@jest/globals";

import { VOID_REASON_CATEGORY_KEY, VOID_REASON_OTHER } from "@repo/domain/form";

import { fieldCategories } from "./field-categories";
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

  it("作廢原因是底座系統類別:key 不變(`void-reason`),選項 輸入錯誤 / 重複建立 / 交易取消 / 其他(其他排最後)", () => {
    expect(VOID_REASON_CATEGORY_KEY).toBe("void-reason");
    expect(
      fieldCategories.entries.find(
        (entry) => entry.key === VOID_REASON_CATEGORY_KEY,
      )?.data,
    ).toMatchObject({ name: "作廢原因", enabled: true });
    const options = fields.entries.filter((entry) =>
      entry.key.startsWith(`${VOID_REASON_CATEGORY_KEY}.`),
    );
    expect(
      options.map((entry) => [entry.key, entry.data.label, entry.data.order]),
    ).toEqual([
      ["void-reason.input-error", "輸入錯誤", 1],
      ["void-reason.duplicate", "重複建立", 2],
      ["void-reason.transaction-cancelled", "交易取消", 3],
      [`void-reason.${VOID_REASON_OTHER}`, "其他", 4],
    ]);
  });
});
