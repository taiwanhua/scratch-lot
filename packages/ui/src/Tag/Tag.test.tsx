import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Tag } from "./Tag";

describe("Tag", () => {
  it("渲染標籤文字", () => {
    render(<Tag label="系統內建" />);

    expect(screen.getByText("系統內建")).toBeInTheDocument();
  });

  it("每個色調都渲染得出來", () => {
    render(
      <>
        <Tag tone="grey" label="停用" />
        <Tag tone="primary" label="群組" />
        <Tag tone="success" label="啟用" />
        <Tag tone="warning" label="隱藏頁" />
        <Tag tone="error" label="組織外" />
      </>,
    );

    for (const text of ["停用", "群組", "啟用", "隱藏頁", "組織外"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("有 onDelete 時出現關閉鈕,點下去會回報", async () => {
    const user = userEvent.setup();
    const onDelete = jest.fn();
    const { container } = render(<Tag label="客服" onDelete={onDelete} />);

    // MUI 的關閉圖示是 svg、沒有 role,只能用 class 取
    const deleteIcon = container.querySelector(".MuiChip-deleteIcon");
    if (deleteIcon === null) {
      throw new Error("測試找不到關閉鈕");
    }
    await user.click(deleteIcon);

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("沒有 onDelete 就不渲染關閉鈕", () => {
    const { container } = render(<Tag label="客服" />);

    expect(
      container.querySelector(".MuiChip-deleteIcon"),
    ).not.toBeInTheDocument();
  });

  it("給 palette 就以那組色票畫(標出代號),取代 tone", () => {
    render(<Tag palette="green" tone="error" label="分類" />);

    const chip = screen.getByText("分類").closest("[data-palette]");
    expect(chip).toHaveAttribute("data-palette", "green");
    expect(chip).toHaveStyle({ backgroundColor: "#E8F5E9", color: "#1B5E20" });
  });

  it("可點的色票標籤是按鈕,點下去會回報", async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(<Tag palette="orange" label="橘" onClick={onClick} />);

    await user.click(screen.getByRole("button", { name: "橘" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("沒給 palette 就沒有 data-palette", () => {
    render(<Tag label="停用" />);

    expect(
      screen.getByText("停用").closest("[data-palette]"),
    ).not.toBeInTheDocument();
  });
});
