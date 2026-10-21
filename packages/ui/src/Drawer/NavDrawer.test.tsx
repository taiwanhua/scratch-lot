import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NavDrawer } from "./NavDrawer";

describe("NavDrawer", () => {
  it("open 時渲染內容;按 Esc 呼叫 onClose", async () => {
    const onClose = jest.fn();
    render(
      <NavDrawer open onClose={onClose}>
        <nav aria-label="主選單">選單內容</nav>
      </NavDrawer>,
    );
    expect(
      screen.getByRole("navigation", { name: "主選單" }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("呼叫端的 slotProps.paper(含 sx)保留,不被元件的排版蓋掉", () => {
    render(
      <NavDrawer
        open
        onClose={jest.fn()}
        slotProps={{
          paper: { "aria-label": "側欄抽屜", sx: { width: 300 } },
        }}
      >
        選單內容
      </NavDrawer>,
    );
    const paper = screen.getByLabelText("側欄抽屜");
    const style = globalThis.getComputedStyle(paper);
    expect(style.width).toBe("300px");
    expect(style.flexDirection).toBe("column");
  });

  it("open=false 時不渲染內容", () => {
    render(
      <NavDrawer open={false} onClose={jest.fn()}>
        選單內容
      </NavDrawer>,
    );
    expect(screen.queryByText("選單內容")).not.toBeInTheDocument();
  });
});
