import { describe, expect, it } from "@jest/globals";
import { act, render, screen, waitFor } from "@testing-library/react";
import { IntlProvider } from "use-intl";

import { defaultLocale, messages } from "@repo/i18n";
import { AppThemeProvider } from "@repo/ui/app-theme-provider";
import { Dialog } from "@repo/ui/dialog";
import { defaultBrand } from "@repo/ui/theme";

import { useSnackbarStore } from "@/stores/base/useSnackbarStore";

import { SnackbarProvider } from "./SnackbarProvider";

const renderProvider = (isDialogOpen: boolean) =>
  render(
    <IntlProvider locale={defaultLocale} messages={messages[defaultLocale]}>
      <AppThemeProvider brand={defaultBrand}>
        <SnackbarProvider>
          <Dialog open={isDialogOpen} title="編輯">
            內容
          </Dialog>
        </SnackbarProvider>
      </AppThemeProvider>
    </IntlProvider>,
  );

const show = (message: string) => {
  act(() => {
    useSnackbarStore.getState().show("error", message);
  });
};

/**
 * #430:MUI Dialog 開著時 app 根節點被標 `aria-hidden`,Snackbar 的 `role="alert"` 螢幕閱讀器念不到;
 * provider 以視覺隱藏的 `role="status"` 區域補念。查詢一律**不帶 `hidden: true`**。
 */
describe("SnackbarProvider 的無障礙宣讀", () => {
  it("彈窗開著時,提示文案可由 role=status 的 live region 取得", async () => {
    renderProvider(true);
    await screen.findByRole("dialog");

    show("沒有權限執行這個動作。");

    // Snackbar 本體在無障礙樹上是隱藏的(這正是要補念的原因)
    expect(screen.queryByRole("alert")).toBeNull();
    const status = await screen.findByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    await waitFor(() => {
      expect(status).toHaveTextContent("沒有權限執行這個動作。");
    });
  });

  it("連續兩則:live region 換成最新那一則(與 Snackbar 同一個長度 1 的佇列)", async () => {
    renderProvider(true);
    await screen.findByRole("dialog");

    show("第一則");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("第一則");
    });
    show("第二則");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("第二則");
    });
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("沒有彈窗時由 Snackbar 自己的 alert 念,live region 留空(不重複念兩次)", async () => {
    renderProvider(false);

    show("已儲存");

    expect(await screen.findByRole("alert")).toHaveTextContent("已儲存");
    // 給 announcer 的下一拍跑完,再確認它沒有填字
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
