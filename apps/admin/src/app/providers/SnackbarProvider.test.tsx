import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { IntlProvider } from "use-intl";

import { defaultLocale, messages } from "@repo/i18n";
import { AppThemeProvider } from "@repo/ui/app-theme-provider";
import { Dialog } from "@repo/ui/dialog";
import type { SnackbarSeverity } from "@repo/ui/snackbar";
import { defaultBrand } from "@repo/ui/theme";

import {
  type SnackbarOptions,
  useSnackbarStore,
} from "@/stores/base/useSnackbarStore";
import { querySnackbar } from "@/test/snackbar";

import { SnackbarProvider } from "./SnackbarProvider";

const renderProvider = (isDialogOpen = false) =>
  render(
    <IntlProvider locale={defaultLocale} messages={messages[defaultLocale]}>
      <AppThemeProvider brand={defaultBrand}>
        <SnackbarProvider>
          <button type="button">畫面其他地方</button>
          <Dialog open={isDialogOpen} title="編輯">
            內容
          </Dialog>
        </SnackbarProvider>
      </AppThemeProvider>
    </IntlProvider>,
  );

const show = (
  severity: SnackbarSeverity,
  message: string,
  options?: SnackbarOptions,
) => {
  act(() => {
    useSnackbarStore.getState().show(severity, message, options);
  });
};

/** 一則操作結果提示 */
const showResult = (message: string) => {
  show("success", message);
};
/** 一則新通知提示(底座規格 BS-08:Info、有標題、沒有動作) */
const showNotification = (message: string) => {
  show("info", message, { title: "新通知" });
};
/** 一則可撤銷提示(Success + [撤銷]) */
const showUndoable = (message: string) => {
  show("success", message, {
    action: {
      label: "撤銷",
      onClick: () => {
        // 這個案子不驗撤銷本身
      },
    },
  });
};

/** 畫面上的提示,由上到下的文字。 */
const stackTexts = (): string[] => {
  const stack = querySnackbar();
  if (stack === null) {
    return [];
  }
  return [...stack.querySelectorAll(".MuiAlert-root")].map(
    (card) => card.textContent,
  );
};

/** 堆疊容器的 emotion 類別。 */
const stackClass = (): string => {
  const stack = querySnackbar();
  const found = [...(stack?.classList ?? [])].find((name) =>
    name.startsWith("css-"),
  );
  if (found === undefined) {
    throw new Error("堆疊容器沒有 emotion 類別");
  }
  return found;
};

/**
 * 某個 media 條件底下、這個類別最後宣告的屬性值(jsdom 不算版面,改讀 emotion 寫出的規則;
 * 同 TEST-09 的做法,`@repo/ui` 的 css-rules helper 不對外匯出)。
 */
const mediaValue = (
  media: string,
  className: string,
  property: string,
): string | null =>
  [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter(
      (rule): rule is CSSMediaRule =>
        rule instanceof CSSMediaRule && rule.conditionText.includes(media),
    )
    .flatMap((rule) => [...rule.cssRules])
    .filter(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && rule.selectorText.includes(className),
    )
    .map((rule) => rule.style.getPropertyValue(property))
    .findLast((value) => value !== "") ?? null;

/**
 * 主題開了 CSS 變數(`cssVariables`),`theme.spacing(n)` 寫出來是 `calc(n * var(--mui-spacing))`;
 * spacing 單位是 8px,所以 3 = 24、2 = 16。
 */
const SPACING_24 = "calc(3 * var(--mui-spacing))";
const SPACING_16 = "calc(2 * var(--mui-spacing))";

/** 底座規格 10.12 的情境表:一列一個測試。 */
describe("SnackbarProvider:位置與堆疊(底座規格 10.12)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("畫面上有一則操作結果提示,又來一則操作結果 → 往上疊,新的在下面,畫面上有兩則", () => {
    renderProvider();

    showResult("已儲存");
    showResult("已刪除");

    expect(stackTexts()).toEqual(["已儲存", "已刪除"]);
  });

  it("畫面上有操作結果提示,來一則新通知提示 → 新通知提示在下面,操作結果提示往上推", () => {
    renderProvider();

    showResult("已儲存");
    showNotification("你有 1 則新通知");

    expect(stackTexts()).toEqual(["已儲存", "新通知你有 1 則新通知"]);
  });

  it("連續來可撤銷提示或新通知提示 → 往上疊,新的在下面", () => {
    renderProvider();

    showUndoable("已售出 3 張");
    showNotification("你有 1 則新通知");
    showUndoable("已兌獎 1 張");

    expect(stackTexts()).toEqual([
      "已售出 3 張撤銷",
      "新通知你有 1 則新通知",
      "已兌獎 1 張撤銷",
    ]);
  });

  it("已有 3 則,第 4 則出現(不論哪一種)→ 最舊的那則消失,畫面上維持 3 則", () => {
    renderProvider();

    showResult("第一則");
    showNotification("第二則");
    showUndoable("第三則");
    showResult("第四則");

    expect(stackTexts()).toEqual(["新通知第二則", "第三則撤銷", "第四則"]);
    expect(useSnackbarStore.getState().items).toHaveLength(3);
  });

  it("滑鼠移上任一則 → 那一則暫停計時,移開後重新計時(其他則照常消失)", () => {
    jest.useFakeTimers();
    renderProvider();

    showResult("停住的那一則");
    showResult("照常消失的那一則");
    const [paused] = [
      ...(querySnackbar()?.querySelectorAll(".MuiAlert-root") ?? []),
    ];

    fireEvent.mouseEnter(paused);
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(stackTexts()).toEqual(["停住的那一則"]);

    fireEvent.mouseLeave(paused);
    act(() => {
      jest.advanceTimersByTime(3999);
    });
    expect(stackTexts()).toEqual(["停住的那一則"]);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(stackTexts()).toEqual([]);
  });

  it("點畫面其他地方 → 不關閉(沒有 clickaway)", () => {
    renderProvider();

    showResult("已儲存");
    fireEvent.click(screen.getByRole("button", { name: "畫面其他地方" }));

    expect(stackTexts()).toEqual(["已儲存"]);
  });

  it("有對話框開著 → 照現行 SnackbarAnnouncer 以 role=status 補念(念最新那一則)", async () => {
    renderProvider(true);
    await screen.findByRole("dialog");

    show("error", "沒有權限執行這個動作。");

    // 提示本體在無障礙樹上是隱藏的(這正是要補念的原因)
    expect(screen.queryByRole("alert")).toBeNull();
    const status = await screen.findByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "沒有權限執行這個動作。",
      );
    });

    showNotification("你有 1 則新通知");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "新通知 你有 1 則新通知",
      );
    });
    // 只有一個 live region;畫面上兩則都在
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(stackTexts()).toHaveLength(2);
  });

  it("沒有對話框時由提示自己的 alert 念,live region 留空(不重複念兩次)", async () => {
    renderProvider();

    showResult("已儲存");

    expect(await screen.findByRole("alert")).toHaveTextContent("已儲存");
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("電腦 / 平板 → 右下角,距邊 24", () => {
    renderProvider();
    showResult("已儲存");

    const className = stackClass();
    // MUI 的 sm 斷點 600px 以上
    expect(mediaValue("min-width:600px", className, "right")).toBe(SPACING_24);
    expect(mediaValue("min-width:600px", className, "bottom")).toBe(SPACING_24);
    expect(mediaValue("min-width:600px", className, "left")).toBe("auto");
  });

  it("手機 → 底部置中、左右 16 滿寬(admin 沒有底部導覽,不加位移)", () => {
    renderProvider();
    showResult("已儲存");

    const className = stackClass();
    expect(mediaValue("min-width:0px", className, "left")).toBe(SPACING_16);
    expect(mediaValue("min-width:0px", className, "right")).toBe(SPACING_16);
    expect(mediaValue("min-width:0px", className, "bottom")).toBe(SPACING_16);
  });

  it("按某一則的 ✕ 只關掉那一則", async () => {
    renderProvider();
    showResult("第一則");
    showResult("第二則");

    const stack = querySnackbar();
    if (stack === null) {
      throw new Error("找不到堆疊");
    }
    const [first] = within(stack).getAllByRole("alert");
    fireEvent.click(within(first).getByRole("button", { name: "關閉" }));

    await waitFor(() => {
      expect(stackTexts()).toEqual(["第二則"]);
    });
  });
});
