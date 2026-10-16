import { describe, expect, it } from "@jest/globals";
import { z } from "zod";

import {
  isSameUrlState,
  parseUrlState,
  serializeUrlState,
  urlStateDefault,
} from "./url-state";

const listSchema = z
  .object({
    status: z.enum(["all", "reviewing", "done"]),
    page: z.number().int().min(1),
  })
  .default({ status: "all", page: 1 });

const tabSchema = z.enum(["mine", "tasks"]).default("mine");

describe("url-state(網址值 ↔ 狀態)", () => {
  it("物件寫成 JSON、字串原樣寫(?tab=mine 而不是 ?tab=%22mine%22)", () => {
    expect(serializeUrlState({ status: "done", page: 2 })).toBe(
      '{"status":"done","page":2}',
    );
    expect(serializeUrlState("tasks")).toBe("tasks");
  });

  it("寫出去的值讀回來一樣", () => {
    const value = { status: "reviewing", page: 3 } as const;
    expect(parseUrlState(listSchema, serializeUrlState(value))).toEqual(value);
    expect(parseUrlState(tabSchema, serializeUrlState("tasks"))).toBe("tasks");
  });

  it("數字、布林這類非字串值走 JSON", () => {
    const pageSchema = z.number().default(1);
    expect(parseUrlState(pageSchema, serializeUrlState(4))).toBe(4);
  });

  it.each([
    ["JSON 語法壞掉", '{"status":"done",'],
    ["欄位值不在列舉裡", '{"status":"hacked","page":1}'],
    ["型別不對", '{"status":"done","page":"abc"}'],
    ["根本不是 JSON", "not-json"],
  ])("網址被改壞(%s)→ 回 null,不丟錯", (_case, raw) => {
    expect(() => parseUrlState(listSchema, raw)).not.toThrow();
    expect(parseUrlState(listSchema, raw)).toBeNull();
  });

  it("字串 schema 不接受列舉外的值", () => {
    expect(parseUrlState(tabSchema, "admin")).toBeNull();
  });

  it("預設值取自 schema 的 .default(…)", () => {
    expect(urlStateDefault(listSchema)).toEqual({ status: "all", page: 1 });
    expect(urlStateDefault(tabSchema)).toBe("mine");
  });

  it("schema 沒宣告預設值 → 開發期就丟錯(不讓頁面帶著沒有預設的狀態上線)", () => {
    expect(() => urlStateDefault(z.string())).toThrow(/default/);
  });

  it("物件以內容比較是否相等(回到預設值才清得掉網址參數)", () => {
    expect(
      isSameUrlState({ status: "all", page: 1 }, { status: "all", page: 1 }),
    ).toBe(true);
    expect(
      isSameUrlState({ status: "all", page: 1 }, { status: "all", page: 2 }),
    ).toBe(false);
  });
});
