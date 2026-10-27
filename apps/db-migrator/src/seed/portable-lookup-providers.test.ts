import { describe, expect, it } from "@jest/globals";

import { portableLookupProvidersOf } from "./portable-lookup-providers";

const PATH = "seeds/registry.ts";

describe("registry 檔的 seedLookupProviders 形狀檢查", () => {
  it("沒有匯出 = 空;合法的原樣回傳", () => {
    expect(portableLookupProvidersOf(undefined, PATH)).toEqual({});
    const providers = {
      catalog_item: { filters: { status: ["on_sale"], enabled: [true] } },
    };
    expect(portableLookupProvidersOf(providers, PATH)).toBe(providers);
  });

  it("不是物件、filters 不是物件、值不是字串 / 布林陣列 → 指出是哪一筆哪一欄", () => {
    expect(() => portableLookupProvidersOf([], PATH)).toThrow(
      /seedLookupProviders 必須是物件/,
    );
    expect(() =>
      portableLookupProvidersOf({ catalog_item: { filters: [] } }, PATH),
    ).toThrow(/seedLookupProviders\.catalog_item 必須是 \{ filters: 物件 \}/);
    expect(() =>
      portableLookupProvidersOf({ catalog_item: "on_sale" }, PATH),
    ).toThrow(/catalog_item 必須是/);
    expect(() =>
      portableLookupProvidersOf(
        { catalog_item: { filters: { status: "on_sale" } } },
        PATH,
      ),
    ).toThrow(/catalog_item\.filters\.status 必須是字串或布林的陣列/);
    expect(() =>
      portableLookupProvidersOf(
        { catalog_item: { filters: { status: ["on_sale", 1] } } },
        PATH,
      ),
    ).toThrow(/filters\.status 必須是字串或布林的陣列/);
  });
});
