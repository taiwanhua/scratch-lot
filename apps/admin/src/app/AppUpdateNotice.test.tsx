import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import { IntlProvider } from "use-intl";

import { defaultLocale, messages } from "@repo/i18n";
import { AppThemeProvider } from "@repo/ui/app-theme-provider";
import { defaultBrand } from "@repo/ui/theme";

import {
  PRELOAD_ERROR_EVENT,
  reportAppUpdateError,
  useAppUpdateNotice,
} from "@/hooks/base/useAppUpdateNotice";
import { ROUTE_CHECK_INTERVAL_MS } from "@/lib/base/app-version";
import { useAppUpdateStore } from "@/stores/base/useAppUpdateStore";
import { useSnackbarStore } from "@/stores/base/useSnackbarStore";

import { SnackbarProvider } from "./providers/SnackbarProvider";

const MESSAGE = messages[defaultLocale].admin.app.update.message;
const RELOAD = messages[defaultLocale].admin.app.update.reload;

interface HarnessProps {
  currentVersion: string | undefined;
  fetchVersion: () => Promise<string | null>;
  reload: () => void;
}

/** 掛 hook + 一顆換路由的按鈕(換路由觸發檢查) */
const Harness = ({ currentVersion, fetchVersion, reload }: HarnessProps) => {
  useAppUpdateNotice({ currentVersion, fetchVersion, reload });
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        void navigate(`/page-${String(Date.now())}`);
      }}
    >
      換頁
    </button>
  );
};

interface SetupOptions {
  /** 不給 = "v1";明確給 undefined = 沒有烘入版本(本機開發) */
  currentVersion?: string;
  deployed?: string | null;
}

const setup = (options: SetupOptions = {}) => {
  const currentVersion =
    "currentVersion" in options ? options.currentVersion : "v1";
  const deployed = options.deployed === undefined ? "v1" : options.deployed;
  const fetchVersion = jest.fn(() => Promise.resolve(deployed));
  const reload = jest.fn();
  render(
    <IntlProvider locale={defaultLocale} messages={messages[defaultLocale]}>
      <AppThemeProvider brand={defaultBrand}>
        <MemoryRouter initialEntries={["/"]}>
          <SnackbarProvider>
            <Harness
              currentVersion={currentVersion}
              fetchVersion={fetchVersion}
              reload={reload}
            />
          </SnackbarProvider>
        </MemoryRouter>
      </AppThemeProvider>
    </IntlProvider>,
  );
  return { fetchVersion, reload };
};

/** 分頁回到前景(jsdom 的 visibilityState 固定是 visible) */
const returnToForeground = async () => {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
  });
};

const goToAnotherPage = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "換頁" }));
    await Promise.resolve();
  });
};

const noticeCount = () => screen.queryAllByText(MESSAGE).length;

afterEach(() => {
  jest.useRealTimers();
});

describe("useAppUpdateNotice:偵測到新版本時提示重新整理", () => {
  it("版本相同:回前景只檢查、不提示", async () => {
    const { fetchVersion } = setup({ deployed: "v1" });
    await returnToForeground();
    expect(fetchVersion).toHaveBeenCalledTimes(1);
    expect(noticeCount()).toBe(0);
  });

  it("版本不同:提示一次(資訊色、[重新整理]、不自動消失),再觸發也不疊第二則;按下才 reload", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const { reload } = setup({ deployed: "v2" });
    await returnToForeground();
    expect(noticeCount()).toBe(1);
    const card = screen.getByText(MESSAGE).closest(".MuiAlert-root");
    expect(card).toHaveClass("MuiAlert-colorInfo");

    await returnToForeground();
    act(() => {
      useAppUpdateStore.getState().markOutdated();
    });
    expect(noticeCount()).toBe(1);

    // 一般提示 4 秒、有動作 8 秒就消失;這則要留著
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(noticeCount()).toBe(1);
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(
      within(card as HTMLElement).getByRole("button", { name: RELOAD }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("按 ✕ 關掉後,下一次觸發再顯示", async () => {
    setup({ deployed: "v2" });
    await returnToForeground();
    const { items, dismiss } = useSnackbarStore.getState();
    act(() => {
      dismiss(items[0]?.id ?? -1);
    });
    expect(noticeCount()).toBe(0);
    await returnToForeground();
    expect(noticeCount()).toBe(1);
  });

  it("換路由:距上次檢查未滿 1 分鐘不抓,滿了才抓", async () => {
    jest.useFakeTimers({ advanceTimers: true });
    const { fetchVersion } = setup({ deployed: "v2" });
    await goToAnotherPage();
    expect(fetchVersion).not.toHaveBeenCalled();

    jest.setSystemTime(Date.now() + ROUTE_CHECK_INTERVAL_MS);
    await goToAnotherPage();
    expect(fetchVersion).toHaveBeenCalledTimes(1);
    expect(noticeCount()).toBe(1);
  });

  it("lazy chunk 載入失敗:不比版本、直接提示", () => {
    const { fetchVersion } = setup();
    act(() => {
      globalThis.dispatchEvent(new Event(PRELOAD_ERROR_EVENT));
    });
    expect(fetchVersion).not.toHaveBeenCalled();
    expect(noticeCount()).toBe(1);
  });

  it("api 回 GRAPHQL_VALIDATION_FAILED:直接提示;其他錯誤不提示", () => {
    setup();
    act(() => {
      reportAppUpdateError({
        response: { errors: [{ extensions: { code: "FORBIDDEN" } }] },
      });
    });
    expect(noticeCount()).toBe(0);
    act(() => {
      reportAppUpdateError({
        response: {
          errors: [{ extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }],
        },
      });
    });
    expect(noticeCount()).toBe(1);
  });

  it("本機開發(沒有烘入版本):不檢查、任何訊號都不提示", async () => {
    const { fetchVersion } = setup({
      currentVersion: undefined,
      deployed: "v2",
    });
    await returnToForeground();
    await goToAnotherPage();
    act(() => {
      globalThis.dispatchEvent(new Event(PRELOAD_ERROR_EVENT));
      useAppUpdateStore.getState().markOutdated();
    });
    expect(fetchVersion).not.toHaveBeenCalled();
    expect(noticeCount()).toBe(0);
  });
});
