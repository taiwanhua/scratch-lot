import { describe, expect, it } from "@jest/globals";

import { seedRegistry } from "../../seeds/registry";
import {
  SeedCompositionError,
  planSeedRegistry,
} from "../seed/seed-composition";

/** 組裝被拒絕時的問題清單(沒被拒絕就讓測試失敗)。 */
function problemsOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof SeedCompositionError) {
      return [...error.problems];
    }
    return [error instanceof Error ? error.message : String(error)];
  }
  throw new Error("預期組裝被拒絕,但通過了");
}

describe("正式 registry 的專案 lookup 來源", () => {
  it("預檢沒帶專案宣告的可攜 lookup 來源:引用專案來源的受管表單判為不可攜(沒有隱含的全域狀態)", () => {
    expect(
      problemsOf(() =>
        planSeedRegistry([{ origin: "test", seeds: seedRegistry }]),
      ).join(" "),
    ).toMatch(
      /lookup 來源 lottery_game 不在可攜範圍.*LOOKUP_PROVIDER_UNSUPPORTED/,
    );
  });
});
