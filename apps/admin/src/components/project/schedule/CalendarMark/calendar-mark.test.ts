import { describe, expect, it } from "@jest/globals";

import { tagPaletteBackground, tagPaletteColorOf } from "@repo/ui/theme";

import {
  calendarMarkBackground,
  calendarMarkMonthBackground,
  calendarMarkOf,
} from "./calendar-mark";

const closed = calendarMarkOf({ type: "closed" });
const special = calendarMarkOf({
  type: "special",
  paletteKey: "cyan",
  name: "店慶",
});
const none = calendarMarkOf({ type: "normal" });

/** 行事曆標示 → 底色(規格 14.5「行事曆標示」、14.6):各檢視共用這一支。 */
describe("calendarMarkBackground", () => {
  it("店休 → 店休灰(同班表停用欄、時間軸停用區);特殊日 → 色票底色;其他 → 空", () => {
    expect(calendarMarkBackground(closed)).toBe("action.disabledBackground");
    expect(calendarMarkBackground(special)).toBe(tagPaletteBackground("cyan"));
    expect(calendarMarkBackground(none)).toBeUndefined();
  });

  it("店休由底座元件的停用畫時:店休回空,特殊日照舊", () => {
    const options = { closedByComponent: true };
    expect(calendarMarkBackground(closed, options)).toBeUndefined();
    expect(calendarMarkBackground(special, options)).toBe(
      tagPaletteBackground("cyan"),
    );
  });
});

describe("calendarMarkMonthBackground(底座 MonthCalendar 的來源色)", () => {
  it("特殊日 → 色票代表色(底座淡化);店休與其他 → 空", () => {
    expect(calendarMarkMonthBackground(special)).toBe(
      tagPaletteColorOf("cyan"),
    );
    expect(calendarMarkMonthBackground(closed)).toBeUndefined();
    expect(calendarMarkMonthBackground(none)).toBeUndefined();
  });
});
