import { describe, expect, it } from "@jest/globals";
import { render } from "@testing-library/react";

import { DotIcon } from "./DotIcon";
import {
  DEFAULT_MODULE_ICON,
  MODULE_ICONS,
  MODULE_ICON_KEYS,
  isModuleIconKey,
  moduleIconLabelOf,
  moduleIconOf,
} from "./module-icon-registry";

describe("模組圖示登錄表", () => {
  it("是 30 個 key,順序即顯示順序,沒有重複", () => {
    expect(MODULE_ICON_KEYS).toHaveLength(30);
    expect(new Set(MODULE_ICON_KEYS).size).toBe(30);
    expect(MODULE_ICON_KEYS[0]).toBe("dashboard");
  });

  it("key 一律 kebab-case(資料庫存的就是它,不能跟著元件名改)", () => {
    for (const key of MODULE_ICON_KEYS) {
      expect(key).toMatch(/^[a-z][\da-z]*(-[\da-z]+)*$/);
    }
  });

  it.each(MODULE_ICON_KEYS)("`%s` 畫得出 svg,且有繁中短詞", (key) => {
    const Icon = moduleIconOf(key);
    const { container } = render(<Icon fontSize="small" />);

    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelectorAll("path, circle").length).toBeGreaterThan(
      0,
    );
    expect(MODULE_ICONS[key].label.length).toBeGreaterThan(0);
    expect(moduleIconLabelOf(key)).toBe(MODULE_ICONS[key].label);
  });

  it("圖示顏色跟著文字色(MUI SvgIcon 的 fill: currentColor),不帶裸色值", () => {
    const Icon = moduleIconOf("dashboard");
    const { container } = render(<Icon />);

    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("fill")).not.toBe("none");
    for (const vector of container.querySelectorAll("path")) {
      const fill = vector.getAttribute("fill");
      expect(fill === null || fill === "currentColor").toBe(true);
    }
  });

  it.each([
    ["表裡沒有的 key", "no-such-icon"],
    ["空字串", ""],
    ["null", null],
    ["undefined", undefined],
    // 物件原型上的名字不算命中(`in` 對繼承屬性為 true,所以登錄表必須擋掉)
    ["原型上的屬性名", "toString"],
  ])("%s 回預設圖示 DotIcon", (_case, value) => {
    expect(moduleIconOf(value)).toBe(DEFAULT_MODULE_ICON);
    expect(DEFAULT_MODULE_ICON).toBe(DotIcon);
    expect(isModuleIconKey(value)).toBe(false);
    expect(moduleIconLabelOf(value)).toBeUndefined();
  });

  it("未知 key 也畫得出東西(畫面不會缺一塊)", () => {
    const Icon = moduleIconOf("no-such-icon");
    const { container } = render(<Icon />);

    expect(container.querySelector("svg")).not.toBeNull();
  });
});
