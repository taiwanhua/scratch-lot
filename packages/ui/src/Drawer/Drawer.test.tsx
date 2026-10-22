import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Button } from "../Button/Button";
import { TextField } from "../TextField/TextField";
import { Drawer } from "./Drawer";

/** 非遮罩抽屜:外面一顆按鈕打開它(關閉後焦點要回到這顆) */
const NonModal = () => {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        打開
      </Button>
      <Button>外面的按鈕</Button>
      <Drawer
        open={isOpen}
        isModal={false}
        anchor="right"
        title="屬性"
        closeLabel="關閉"
        onClose={() => {
          setOpen(false);
        }}
      >
        <TextField label="名稱" />
      </Drawer>
    </>
  );
};

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

  it("isModal=false:不蓋遮罩、外面照樣能點;打開時焦點移進抽屜,Esc 關閉並把焦點還給打開它的元素", async () => {
    const user = userEvent.setup();
    render(<NonModal />);
    const opener = screen.getByRole("button", { name: "打開" });
    await user.click(opener);
    const name = await screen.findByRole("textbox", { name: "名稱" });
    expect(screen.getByRole("region", { name: "屬性" })).toContainElement(name);
    expect(screen.queryByRole("presentation")).toBeNull();
    expect(document.activeElement).not.toBe(opener);
    expect(document.activeElement?.contains(name)).toBe(true);

    await user.click(screen.getByRole("button", { name: "外面的按鈕" }));
    expect(screen.getByRole("textbox", { name: "名稱" })).toBeVisible();

    await user.click(name);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "名稱" })).toBeNull();
    });
    expect(opener).toHaveFocus();
  });
});
