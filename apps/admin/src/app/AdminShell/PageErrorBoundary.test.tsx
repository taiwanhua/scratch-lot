import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Suspense, lazy } from "react";
import {
  MemoryRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { IntlProvider } from "use-intl";

import { defaultLocale, messages } from "@repo/i18n";
import { AppThemeProvider } from "@repo/ui/app-theme-provider";
import { defaultBrand } from "@repo/ui/theme";

import { useAppUpdateNotice } from "@/hooks/base/useAppUpdateNotice";

import { SnackbarProvider } from "../providers/SnackbarProvider";
import { PageErrorBoundary, PageErrorFallback } from "./PageErrorBoundary";

const text = messages[defaultLocale].admin;
const NOTICE = text.app.update.message;
const FALLBACK = text.shell.pageError.title;

/** 部署後舊分頁要的 chunk 已不在:動態 import 失敗 */
const BrokenPage = lazy(() =>
  Promise.reject(
    new TypeError(
      "Failed to fetch dynamically imported module: /assets/Page-old.js",
    ),
  ),
);

/** 一般的 render 錯誤(不是 chunk 失敗) */
const ThrowingPage = () => {
  throw new Error("boom");
};

/** 殼的替身:側欄 + 頁面區(與 `ShellLayout` 同樣把 boundary 包在 `<Outlet>` 外,以路徑重置) */
const ShellStandIn = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useAppUpdateNotice({
    currentVersion: "v1",
    fetchVersion: () => Promise.resolve("v1"),
  });
  return (
    <>
      <nav aria-label="側欄">
        <button
          type="button"
          onClick={() => {
            void navigate("/ok");
          }}
        >
          正常頁
        </button>
      </nav>
      <main>
        <PageErrorBoundary resetKey={pathname}>
          <Suspense fallback="載入中">
            <Outlet />
          </Suspense>
        </PageErrorBoundary>
      </main>
    </>
  );
};

const renderAt = (path: string) =>
  render(
    <IntlProvider locale={defaultLocale} messages={messages[defaultLocale]}>
      <AppThemeProvider brand={defaultBrand}>
        <SnackbarProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route element={<ShellStandIn />}>
                <Route path="/broken" element={<BrokenPage />} />
                <Route path="/throwing" element={<ThrowingPage />} />
                <Route path="/ok" element={<p>正常內容</p>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </SnackbarProvider>
      </AppThemeProvider>
    </IntlProvider>,
  );

/** React 會把接住的錯誤印到 console;測試裡是預期的,不讓它洗版 */
const silenceConsoleError = () =>
  jest.spyOn(console, "error").mockImplementation(jest.fn());

describe("PageErrorBoundary:頁面區出錯只換掉頁面區", () => {
  it("lazy 頁面 chunk 載入失敗 → 替代畫面 +「系統已更新」提示,側欄仍在;換路由後恢復", async () => {
    const spy = silenceConsoleError();
    renderAt("/broken");

    expect(
      await screen.findByRole("heading", { name: FALLBACK }),
    ).toBeInTheDocument();
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "側欄" }),
    ).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "正常頁" }));
    });
    expect(await screen.findByText("正常內容")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: FALLBACK })).toBeNull();
    spy.mockRestore();
  });

  it("一般 render 錯誤 → 替代畫面,但不跳更新提示", async () => {
    const spy = silenceConsoleError();
    renderAt("/throwing");
    expect(
      await screen.findByRole("heading", { name: FALLBACK }),
    ).toBeInTheDocument();
    expect(screen.queryByText(NOTICE)).toBeNull();
    spy.mockRestore();
  });
});

describe("PageErrorFallback", () => {
  it("[重新整理] 觸發 reload", () => {
    const onReload = jest.fn();
    render(
      <IntlProvider locale={defaultLocale} messages={messages[defaultLocale]}>
        <PageErrorFallback onReload={onReload} />
      </IntlProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: text.shell.pageError.reload }),
    );
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
