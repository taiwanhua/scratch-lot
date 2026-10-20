import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button/Button";
import { Drawer } from "./Drawer";

describe("Drawer", () => {
  it("open 時渲染標題、內容、動作列;關閉鈕呼叫 onClose", async () => {
    const onClose = jest.fn();
    render(
      <Drawer
        open
        anchor="right"
        title="篩選"
        closeLabel="關閉"
        onClose={onClose}
        actions={<Button>套用</Button>}
      >
        內容
      </Drawer>,
    );
    expect(screen.getByText("篩選")).toBeInTheDocument();
    expect(screen.getByText("內容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "套用" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "關閉" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("open=false 時不渲染內容", () => {
    render(
      <Drawer
        open={false}
        anchor="bottom"
        title="篩選"
        closeLabel="關閉"
        onClose={jest.fn()}
      >
        內容
      </Drawer>,
    );
    expect(screen.queryByText("內容")).not.toBeInTheDocument();
  });
});
