import { describe, expect, it } from "@jest/globals";
import { render } from "@testing-library/react";

import { AddIcon } from "./AddIcon";
import { ArrowDownIcon } from "./ArrowDownIcon";
import { ArrowUpIcon } from "./ArrowUpIcon";
import { CheckIcon } from "./CheckIcon";
import { ChevronDoubleLeftIcon } from "./ChevronDoubleLeftIcon";
import { ChevronDoubleRightIcon } from "./ChevronDoubleRightIcon";
import { ChevronDownIcon } from "./ChevronDownIcon";
import { ChevronLeftIcon } from "./ChevronLeftIcon";
import { ChevronRightIcon } from "./ChevronRightIcon";
import { CloseIcon } from "./CloseIcon";
import { DarkModeIcon } from "./DarkModeIcon";
import { DeleteIcon } from "./DeleteIcon";
import { DevicesIcon } from "./DevicesIcon";
import { DotIcon } from "./DotIcon";
import { EditIcon } from "./EditIcon";
import { HelpIcon } from "./HelpIcon";
import { LightModeIcon } from "./LightModeIcon";
import { LogoutIcon } from "./LogoutIcon";
import { SettingsIcon } from "./SettingsIcon";
import { SystemModeIcon } from "./SystemModeIcon";
import { ViewIcon } from "./ViewIcon";

/** 手繪的殼圖示:path 取自 Figma 匯出的 SVG,每一筆顏色都明寫 `currentColor`。 */
const icons = [
  { name: "ChevronDownIcon", Icon: ChevronDownIcon },
  { name: "ChevronLeftIcon", Icon: ChevronLeftIcon },
  { name: "ChevronRightIcon", Icon: ChevronRightIcon },
  { name: "DotIcon", Icon: DotIcon },
  { name: "CloseIcon", Icon: CloseIcon },
  { name: "CheckIcon", Icon: CheckIcon },
  { name: "HelpIcon", Icon: HelpIcon },
] as const;

/**
 * 通用操作圖示(#307):取自 `@mui/icons-material` 的 Outlined 單檔(Figma `Draft/ActionIcon`
 * 253:3264 標明來源),所以 path 上**沒有**顏色屬性 —— 顏色來自 `SvgIcon` 根節點的
 * `fill: currentColor`。斷言因此改成「畫得出向量,且沒有任何寫死的色值」。
 */
const actionIcons = [
  { name: "ViewIcon", Icon: ViewIcon },
  { name: "EditIcon", Icon: EditIcon },
  { name: "DeleteIcon", Icon: DeleteIcon },
  { name: "SettingsIcon", Icon: SettingsIcon },
  { name: "AddIcon", Icon: AddIcon },
  { name: "ArrowUpIcon", Icon: ArrowUpIcon },
  { name: "ArrowDownIcon", Icon: ArrowDownIcon },
  { name: "ChevronDoubleLeftIcon", Icon: ChevronDoubleLeftIcon },
  { name: "ChevronDoubleRightIcon", Icon: ChevronDoubleRightIcon },
  { name: "SystemModeIcon", Icon: SystemModeIcon },
  { name: "LightModeIcon", Icon: LightModeIcon },
  { name: "DarkModeIcon", Icon: DarkModeIcon },
  { name: "LogoutIcon", Icon: LogoutIcon },
  { name: "DevicesIcon", Icon: DevicesIcon },
] as const;

describe("icons", () => {
  it.each(icons)(
    "$name 畫出向量、顏色一律跟著文字色(currentColor),不帶裸色值",
    ({ Icon }) => {
      const { container } = render(<Icon fontSize="small" />);

      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      const vectors = container.querySelectorAll("path, circle");
      expect(vectors.length).toBeGreaterThan(0);
      for (const vector of vectors) {
        const paint = [
          vector.getAttribute("stroke"),
          vector.getAttribute("fill"),
        ].filter((value) => value !== null && value !== "none");
        expect(paint).not.toHaveLength(0);
        for (const value of paint) {
          expect(value).toBe("currentColor");
        }
      }
    },
  );

  it.each(actionIcons)(
    "$name(MUI Outlined)畫出向量,且不帶寫死的色值",
    ({ Icon }) => {
      const { container } = render(<Icon fontSize="small" />);

      const vectors = container.querySelectorAll("path, circle");
      expect(vectors.length).toBeGreaterThan(0);
      for (const vector of vectors) {
        for (const attribute of ["stroke", "fill"]) {
          const value = vector.getAttribute(attribute);
          // 沒寫 = 繼承 SvgIcon 根節點的 `fill: currentColor`,那才是我們要的
          expect(value === null || value === "none").toBe(true);
        }
      }
    },
  );

  it("`titleAccess` 讓圖示有無障礙名稱(沒給時是純裝飾)", () => {
    const { container, rerender } = render(<HelpIcon />);
    expect(container.querySelector("title")).toBeNull();

    rerender(<HelpIcon titleAccess="說明" />);
    expect(container.querySelector("title")?.textContent).toBe("說明");
  });
});
