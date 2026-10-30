import { describe, expect, it } from "@jest/globals";

import { TAG_PALETTE_KEYS } from "@repo/domain/tag-palette";
import { TAG_PALETTE_ORDER } from "@repo/ui/theme";

/**
 * 色票代號有兩份:api 驗證寫入用的 `@repo/domain/tag-palette`,與顏色值所在的 `@repo/ui/theme`
 * (ui 不依賴 domain)。admin 兩邊都用,在這裡把關兩份一模一樣(含順序 = 色票面板的排列)。
 */
describe("標籤色票代號:domain 與 ui 一致", () => {
  it("同樣十組、同樣順序", () => {
    expect([...TAG_PALETTE_ORDER]).toEqual([...TAG_PALETTE_KEYS]);
  });
});
