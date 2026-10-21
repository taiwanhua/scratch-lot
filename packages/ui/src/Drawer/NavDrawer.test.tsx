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

  it("open=false 時不渲染內容", () => {
    render(
      <NavDrawer open={false} onClose={jest.fn()}>
        選單內容
      </NavDrawer>,
    );
    expect(screen.queryByText("選單內容")).not.toBeInTheDocument();
  });
});
