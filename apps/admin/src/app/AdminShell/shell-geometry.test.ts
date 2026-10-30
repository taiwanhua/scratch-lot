import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_SHELL_MIN_WIDTH,
  SHELL_COMPACT_BELOW,
  shellContentMinWidth,
  shellMinWidthApplies,
} from "./shell-geometry";

const spacing = (units: number) => `${String(units * 8)}px`;

describe("shell-geometry:內容區最小寬度", () => {
  it("殼層預設是 md(與精簡版界線同一級:平板寬就排得下)", () => {
    expect(DEFAULT_SHELL_MIN_WIDTH).toBe("md");
    expect(DEFAULT_SHELL_MIN_WIDTH).toBe(SHELL_COMPACT_BELOW);
  });

  it("只有比 md 大的宣告(lg / xl)才產生下限", () => {
    expect(shellMinWidthApplies("md")).toBe(false);
    expect(shellMinWidthApplies("lg")).toBe(true);
    expect(shellMinWidthApplies("xl")).toBe(true);
  });

  it("下限 = 斷點 − 側欄(隨收合狀態)− 左右內距", () => {
    expect(shellContentMinWidth(1536, spacing, false)).toBe(
      "calc(1536px - 240px - 48px)",
    );
    expect(shellContentMinWidth(1536, spacing, true)).toBe(
      "calc(1536px - 64px - 48px)",
    );
  });
});
