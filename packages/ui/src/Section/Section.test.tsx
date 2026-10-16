import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  cssRulesMatching,
  declaredValue,
  emotionClassOf,
} from "../test/css-rules";
import { Section } from "./Section";

describe("Section", () => {
  it("展開:標題列是一顆 aria-expanded=true 的按鈕,內容區看得到,不顯示摘要", () => {
    render(
      <Section title="基本資料" summary="示範摘要">
        <p>放入欄位</p>
      </Section>,
    );

    const header = screen.getByRole("button", { name: "基本資料" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    // aria-controls 指向內容區
    expect(screen.getByText("放入欄位").closest("[id]")).toHaveAttribute(
      "id",
      String(header.getAttribute("aria-controls")),
    );
    expect(screen.getByText("放入欄位")).toBeVisible();
    expect(screen.queryByText("示範摘要")).not.toBeInTheDocument();
  });

  it("defaultCollapsed:一開始收合,標題列顯示摘要,點標題列展開並回報", async () => {
    const onCollapsedChange = jest.fn();
    render(
      <Section
        title="基本資料"
        summary="示範摘要"
        defaultCollapsed
        onCollapsedChange={onCollapsedChange}
      >
        <p>放入欄位</p>
      </Section>,
    );

    const header = screen.getByRole("button", { name: /基本資料/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("示範摘要")).toBeInTheDocument();
    // 收合時內容仍掛著(值與狀態不消失),只是隱藏
    expect(screen.getByText("放入欄位")).not.toBeVisible();

    await userEvent.click(header);

    expect(onCollapsedChange).toHaveBeenCalledWith(false);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("示範摘要")).not.toBeInTheDocument();
  });

  it("受控:以 collapsed 為準,點標題列只回報下一個狀態", async () => {
    const onCollapsedChange = jest.fn();
    render(
      <Section
        title="聯絡方式"
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
      >
        內容
      </Section>,
    );

    const header = screen.getByRole("button", { name: "聯絡方式" });
    await userEvent.click(header);

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  it("collapsible=false:一律展開,標題列不是按鈕(defaultCollapsed 不生效)", () => {
    render(
      <Section title="備註" collapsible={false} defaultCollapsed>
        內容
      </Section>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "備註" })).toBeInTheDocument();
    expect(screen.getByText("內容")).toBeVisible();
  });

  it("外框是以標題命名的 section,id 給在外框上", () => {
    const { container } = render(
      <Section id="form-section-basic" title="基本資料">
        內容
      </Section>,
    );

    const frame = container.querySelector("section");
    expect(frame).toHaveAttribute("id", "form-section-basic");
    expect(frame).toHaveAccessibleName("基本資料");
  });

  it("標題列鍵盤聚焦時有外框(focus-visible)", () => {
    render(<Section title="基本資料">內容</Section>);

    const header = screen.getByRole("button", { name: "基本資料" });
    const rules = cssRulesMatching(emotionClassOf(header), "Mui-focusVisible");
    expect(declaredValue(rules, "outline")).toMatch(/^2px solid/);
  });
});
