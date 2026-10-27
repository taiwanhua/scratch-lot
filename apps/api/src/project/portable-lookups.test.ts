import { describe, expect, it } from "@jest/globals";

import { LOTTERY_PORTABLE_LOOKUP_PROVIDERS } from "@repo/domain/project/lottery";

import { PROJECT_LOOKUP_PROVIDERS } from "./lookup-providers";

/**
 * 可攜 lookup 來源只有一份正本(`@repo/domain/project/lottery`):api 的 lookup 登記宣告了 `portable` 的那些
 * (匯出 seed 的可攜性目錄)組起來,要和種子組裝讀的常數完全一樣 —— 兩邊各改一半時這裡會紅。
 */
describe("專案 lookup 登記的 portable = 種子組裝的可攜宣告", () => {
  it("宣告了 portable 的來源與內容和 LOTTERY_PORTABLE_LOOKUP_PROVIDERS 相同", () => {
    const declared = Object.fromEntries(
      PROJECT_LOOKUP_PROVIDERS.flatMap(({ declaration }) =>
        declaration.portable === undefined
          ? []
          : [[declaration.key, declaration.portable]],
      ),
    );
    expect(declared).toEqual(LOTTERY_PORTABLE_LOOKUP_PROVIDERS);
  });
});
