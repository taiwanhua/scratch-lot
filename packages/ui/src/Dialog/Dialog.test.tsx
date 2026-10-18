import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button/Button";
import { TextField } from "../TextField/TextField";
import { Dialog } from "./Dialog";

/** 彈窗的內容區(DialogContent)。 */
const contentOf = (): Element => {
  const content = screen
    .getByRole("dialog")
    .querySelector(".MuiDialogContent-root");
  if (content === null) {
    throw new Error("找不到 DialogContent");
  }
  return content;
};

describe("Dialog", () => {
  it("open 時把標題、內文與動作渲染進 portal", () => {
    render(
      <Dialog open title="刪除角色" actions={<Button>刪除</Button>}>
        確定要刪除「客服」?
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("刪除角色");
    expect(dialog).toHaveTextContent("確定要刪除「客服」?");
    expect(screen.getByRole("button", { name: "刪除" })).toBeInTheDocument();
  });

  it("open=false 時不渲染任何彈窗", () => {
    render(
      <Dialog open={false} title="刪除角色">
        確定要刪除「客服」?
      </Dialog>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("點動作插槽的按鈕會觸發其 onClick", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn();
    render(
      <Dialog
        open
        title="刪除角色"
        actions={<Button onClick={onConfirm}>刪除</Button>}
      >
        確定要刪除「客服」?
      </Dialog>,
    );

    await user.click(screen.getByRole("button", { name: "刪除" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  /**
   * MUI 的 `.MuiDialogTitle-root + .MuiDialogContent-root { padding-top: 0 }` 特異度贏過
   * `sx` 的單一 class,上內距被吃掉後,第一個 TextField 的浮動標籤會被標題壓住。
   */
  it("標題 + 表單:內容區上內距沒被標題吃掉,第一個欄位的標籤看得到", () => {
    render(
      <Dialog open title="開通租戶">
        <TextField label="租戶名稱" />
      </Dialog>,
    );

    const content = screen
      .getByRole("dialog")
      .querySelector(".MuiDialogContent-root");
    if (content === null) {
      throw new Error("找不到 DialogContent");
    }

    expect(globalThis.getComputedStyle(content).paddingTop).not.toBe("0px");
    expect(screen.getByLabelText("租戶名稱")).toBeInTheDocument();
  });

  it("沒有動作列時,內容區自己留下內距(按鈕放在內文裡也不貼底);有動作列時由動作列留", () => {
    const { rerender } = render(
      <Dialog open title="列表欄位配置">
        <Button>儲存</Button>
      </Dialog>,
    );
    expect(globalThis.getComputedStyle(contentOf()).paddingBottom).toBe("20px");

    rerender(
      <Dialog open title="列表欄位配置" actions={<Button>儲存</Button>}>
        內文
      </Dialog>,
    );
    expect(globalThis.getComputedStyle(contentOf()).paddingBottom).toBe("0px");
  });
});
