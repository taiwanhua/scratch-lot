import { describe, expect, it } from "@jest/globals";

import { TAG_PALETTE_KEYS } from "../../tag-palette/keys";
import {
  SPECIAL_DAY_PALETTE_KEYS,
  isSpecialDayPaletteKey,
} from "./special-day-palette";

describe("特殊日色票", () => {
  it("灰色以外的九組;null、灰色、清單外都不收", () => {
    expect(SPECIAL_DAY_PALETTE_KEYS).toEqual(
      TAG_PALETTE_KEYS.filter((key) => key !== "grey"),
    );
    expect(isSpecialDayPaletteKey("blue")).toBe(true);
    expect(isSpecialDayPaletteKey("grey")).toBe(false);
    expect(isSpecialDayPaletteKey(null)).toBe(false);
    expect(isSpecialDayPaletteKey("#FFA500")).toBe(false);
  });
});
