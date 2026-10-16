import { describe, expect, it } from "@jest/globals";

import { defaultBrand } from "./brands/default";
import { createAppTheme } from "./create-theme";
import { stateLayerSx } from "./state-layer";

const theme = createAppTheme(defaultBrand);

describe("stateLayerSx(《底座規格》10.11)", () => {
  it("主題的 hoverOpacity / selectedOpacity 是 8% / 16%", () => {
    expect(theme.palette.action.hoverOpacity).toBeCloseTo(0.08);
    expect(theme.palette.action.selectedOpacity).toBeCloseTo(0.16);
  });

  it("滑過疊 main × hoverOpacity 並換邊框;只在有滑過的裝置", () => {
    const sx = stateLayerSx(theme, { tone: "primary" });
    const hover = (sx["@media (hover: hover)"] as Record<string, unknown>)[
      "&:hover"
    ] as Record<string, string>;

    expect(sx.cursor).toBe("pointer");
    expect(sx.backgroundImage).toBe("none");
    expect(hover.backgroundImage).toContain("hoverOpacity");
    expect(hover.backgroundImage).toContain("primary-main");
    expect(hover.boxShadow).toContain("primary-main");
  });

  it("已選取常駐 selectedOpacity 圖層 + 1px main 邊框", () => {
    const sx = stateLayerSx(theme, { tone: "warning", selected: true });

    expect(sx.backgroundImage).toContain("selectedOpacity");
    expect(sx.backgroundImage).toContain("warning-main");
    expect(sx.boxShadow).toMatch(/^inset 0 0 0 1px .*warning-main/);
  });

  it("白底元件(grey)疊 grey/500;鍵盤焦點用 action.focus 外框;按下時加深", () => {
    const sx = stateLayerSx(theme);
    const focus = sx["&:focus-visible"] as Record<string, string>;
    const active = sx["&:active"] as Record<string, string>;

    expect(sx.boxShadow).toBe("none");
    expect(active.backgroundImage).toContain("grey-500");
    expect(active.backgroundImage).toContain("selectedOpacity");
    expect(focus.outline).toContain("action-focus");
  });

  it("selectedTone:白底元件滑過仍是灰,已選取疊主色並加主色框", () => {
    const sx = stateLayerSx(theme, { selected: true, selectedTone: "primary" });
    const hover = (sx["@media (hover: hover)"] as Record<string, unknown>)[
      "&:hover"
    ] as Record<string, string>;

    expect(sx.backgroundImage).toContain("primary-main");
    expect(sx.boxShadow).toContain("primary-main");
    expect(hover.backgroundImage).toContain("grey-500");
    expect(hover.boxShadow).toContain("primary-main");
  });
});
