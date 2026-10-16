import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { cssRulesMatching, declaredValue } from "../test/css-rules";
import { Snackbar } from "./Snackbar";

const noop = () => {
  // 這個案子不驗關閉
};

describe("Snackbar 的內容與外觀", () => {
  it("訊息渲染成 alert;沒有標題、沒有動作時只有 ✕", () => {
    render(<Snackbar message="已儲存" closeLabel="關閉" onClose={noop} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("已儲存");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "關閉" })).toBeInTheDocument();
  });

  it("有標題時標題在訊息上方(MUI AlertTitle)", () => {
    render(
      <Snackbar
        severity="info"
        title="新通知"
        message="你有 2 則新通知"
        closeLabel="關閉"
        onClose={noop}
      />,
    );

    const alert = screen.getByRole("alert");
    const title = alert.querySelector(".MuiAlertTitle-root");
    expect(title).toHaveTextContent("新通知");
    expect(alert).toHaveTextContent("新通知你有 2 則新通知");
  });

  it.each(["success", "error", "warning", "info"] as const)(
    "severity=%s:語氣 class 在卡片上,不顯示語氣圖示",
    (severity) => {
      render(
        <Snackbar
          severity={severity}
          message="訊息"
          closeLabel="關閉"
          onClose={noop}
        />,
      );

      const alert = screen.getByRole("alert");
      const capitalized = `${severity.charAt(0).toUpperCase()}${severity.slice(1)}`;
      expect(alert).toHaveClass(`MuiAlert-color${capitalized}`);
      expect(alert.querySelector(".MuiAlert-icon")).toBeNull();
    },
  );

  /** 左側 4px 色條:每種語氣各綁自己的 palette main(主題 token,不寫死色碼)。 */
  it("左側 4px 色條,顏色取該語氣的 palette main", () => {
    render(
      <Snackbar
        severity="warning"
        message="訊息"
        closeLabel="關閉"
        onClose={noop}
      />,
    );

    const bar = cssRulesMatching("::before");
    expect(declaredValue(bar, "width")).toBe("4px");
    // 沒有 ThemeProvider 時是 MUI 預設主題:warning.main = #ed6c02
    const warningBar = cssRulesMatching("MuiAlert-colorWarning", "::before");
    expect(declaredValue(warningBar, "background-color")).toBe("#ed6c02");
    for (const tone of ["Success", "Error", "Info"]) {
      const rules = cssRulesMatching(`MuiAlert-color${tone}`, "::before");
      expect(declaredValue(rules, "background-color")).not.toBeNull();
    }
  });

  it("動作按鈕在 ✕ 左邊;按下先執行動作再關閉", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    render(
      <Snackbar
        message="已售出 3 張"
        action={{
          label: "撤銷",
          onClick: () => {
            calls.push("action");
          },
        }}
        closeLabel="關閉"
        onClose={() => {
          calls.push("close");
        }}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["撤銷", ""]);
    expect(buttons[1]).toHaveAccessibleName("關閉");

    await user.click(screen.getByRole("button", { name: "撤銷" }));

    expect(calls).toEqual(["action", "close"]);
  });

  it("按 ✕ 會回報 onClose", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<Snackbar message="已儲存" closeLabel="關閉" onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "關閉" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const advance = (ms: number) => {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
};

describe("Snackbar 的計時(fake timers)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("沒有動作:4 秒後自動關", () => {
    const onClose = jest.fn();
    render(<Snackbar message="已儲存" closeLabel="關閉" onClose={onClose} />);

    advance(3999);
    expect(onClose).not.toHaveBeenCalled();
    advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("有動作:8 秒後才自動關", () => {
    const onClose = jest.fn();
    render(
      <Snackbar
        message="已售出 3 張"
        action={{ label: "撤銷", onClick: noop }}
        closeLabel="關閉"
        onClose={onClose}
      />,
    );

    advance(4000);
    expect(onClose).not.toHaveBeenCalled();
    advance(3999);
    expect(onClose).not.toHaveBeenCalled();
    advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("滑鼠移上去暫停計時;移開後重新計時(從頭算完整 4 秒)", () => {
    const onClose = jest.fn();
    render(<Snackbar message="已儲存" closeLabel="關閉" onClose={onClose} />);
    const alert = screen.getByRole("alert");

    advance(3000);
    fireEvent.mouseEnter(alert);
    advance(60_000);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseLeave(alert);
    advance(3999);
    expect(onClose).not.toHaveBeenCalled();
    advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("父層重繪換了新的 onClose 也不會重新計時", () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(
      <Snackbar message="已儲存" closeLabel="關閉" onClose={first} />,
    );

    advance(3000);
    rerender(<Snackbar message="已儲存" closeLabel="關閉" onClose={second} />);
    advance(1000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("autoHideDuration=null 時不會自己關(只能手動關)", () => {
    const onClose = jest.fn();
    render(
      <Snackbar
        message="已送出,等待處理"
        closeLabel="關閉"
        autoHideDuration={null}
        onClose={onClose}
      />,
    );

    advance(60_000);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("點畫面其他地方不會關閉(沒有 clickaway)", () => {
    const onClose = jest.fn();
    render(
      <>
        <button type="button">其他地方</button>
        <Snackbar message="已儲存" closeLabel="關閉" onClose={onClose} />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "其他地方" }));
    fireEvent.mouseDown(document.body);

    expect(onClose).not.toHaveBeenCalled();
  });
});
