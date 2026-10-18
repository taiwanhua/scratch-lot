import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, delay } from "msw";

import type { UpdateMyPreferencesMutationVariables } from "@repo/graphql";

import { COLOR_MODE_STORAGE_KEY } from "@/lib/base/color-mode";
import { LOCALE_STORAGE_KEY } from "@/lib/base/locale";
import { useLocaleStore } from "@/stores/base/useLocaleStore";
import { type AuthWorldOptions, authWorld } from "@/test/msw/auth-handlers";
import { api, server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { findSnackbarAlert } from "@/test/snackbar";

/**
 * 語言跟著帳號(I18N-05):每一列一個測試。
 * 「打開個人設定的偏好分頁」「開 /settings/personal 不帶 tab」「沒有任何權限的使用者開個人設定」
 * 三列在 `PersonalSettingsPage.test.tsx`。
 */

/** 模擬「這台電腦上次留下的語言快取」:寫進 localStorage,再像重新開頁一樣讓 store 讀回來。 */
const cacheLocale = async (locale: string) => {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  await useLocaleStore.persist.rehydrate();
};

/** 已登入(有 refresh cookie)直接進殼。 */
const signedIn = (options: AuthWorldOptions = {}) => {
  const world = authWorld({ hasRefreshCookie: true, ...options });
  server.use(...world.handlers);
  return world;
};

/**
 * 記下 DOM 上出現過的每一個側欄名稱(第一次掛載用哪個語言,不能只看最後的狀態):
 * 屬性被改掉時從 `oldValue` 取回改之前的名稱。
 */
const recordNavLabels = () => {
  const seen = new Set<string>();
  const collect = () => {
    for (const nav of document.querySelectorAll("nav[aria-label]")) {
      seen.add(nav.getAttribute("aria-label") ?? "");
    }
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (
        record.type === "attributes" &&
        record.target instanceof HTMLElement &&
        record.target.tagName === "NAV" &&
        record.oldValue !== null
      ) {
        seen.add(record.oldValue);
      }
    }
    collect();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["aria-label"],
  });
  return {
    seen,
    stop: () => {
      collect();
      observer.disconnect();
    },
  };
};

const openUserMenu = async (
  user: ReturnType<typeof renderApp>["user"],
  name = "小華",
) => {
  await user.click(await screen.findByRole("button", { name }));
};

describe("語言跟著帳號", () => {
  it("頭像選單切語言:立即生效,寫入帳號(settings.locale)與本機快取", async () => {
    const world = signedIn({ preferences: { locale: "zh-TW" } });

    const { user } = renderApp({ path: "/overview" });
    await openUserMenu(user);
    await user.click(screen.getByRole("button", { name: "English" }));

    expect(
      await screen.findByRole("dialog", { name: "User menu" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    await waitFor(() => {
      expect(world.preferences.locale).toBe("en");
    });
  });

  it("頭像選單切外觀:立即生效,只寫本機,不寫帳號", async () => {
    const world = signedIn({ preferences: { locale: "zh-TW" } });

    const { user } = renderApp({ path: "/overview" });
    await openUserMenu(user);
    await user.click(screen.getByRole("button", { name: "暗" }));

    expect(screen.getByRole("button", { name: "暗" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(localStorage.getItem(COLOR_MODE_STORAGE_KEY)).toBe("dark");
    // 帳號已有語言設定:登入時不寫回;切外觀也不寫
    expect(world.calls.updateMyPreferences).toBe(0);
    localStorage.removeItem(COLOR_MODE_STORAGE_KEY);
  });

  it("A 裝置改語言 → B 裝置登入後是新語言", async () => {
    const world = signedIn({ preferences: { locale: "zh-TW" } });

    // A 裝置:切到 English(寫入帳號)
    const deviceA = renderApp({ path: "/overview" });
    await openUserMenu(deviceA.user);
    await deviceA.user.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => {
      expect(world.preferences.locale).toBe("en");
    });
    deviceA.unmount();

    // B 裝置:本機快取還是中文(從沒在這台切過)
    await cacheLocale("zh-TW");
    renderApp({ path: "/overview" });

    expect(
      await screen.findByRole("navigation", { name: "Main navigation" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });

  it("登入,帳號有語言設定:用帳號的語言,並覆寫本機快取(殼第一次掛載就是帳號的語言)", async () => {
    await cacheLocale("zh-TW");
    const world = signedIn({ preferences: { locale: "en" } });
    const labels = recordNavLabels();

    renderApp({ path: "/overview" });

    expect(
      await screen.findByRole("navigation", { name: "Main navigation" }),
    ).toBeInTheDocument();
    labels.stop();
    // 不先提交一次快取的語言:DOM 上從沒出現過中文的側欄
    expect([...labels.seen]).toEqual(["Main navigation"]);
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    expect(world.calls.updateMyPreferences).toBe(0);
  });

  it("登入,帳號沒有語言設定(新帳號):用本機快取,並寫回帳號", async () => {
    await cacheLocale("en");
    const world = signedIn();

    renderApp({ path: "/overview" });

    expect(
      await screen.findByRole("navigation", { name: "Main navigation" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(world.preferences.locale).toBe("en");
    });
  });

  it("登入,帳號沒有語言設定、本機也沒有快取:用預設語言並寫回帳號", async () => {
    const world = signedIn();

    renderApp({ path: "/overview" });

    expect(
      await screen.findByRole("navigation", { name: "主選單" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(world.preferences.locale).toBe("zh-TW");
    });
  });

  it("登入前(登入頁、設定密碼頁):用本機快取,不打偏好", async () => {
    await cacheLocale("en");
    const world = authWorld();
    server.use(...world.handlers);

    const login = renderApp({ path: "/login" });
    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    login.unmount();

    renderApp({ path: "/set-password?token=token-1" });
    expect(await screen.findByLabelText("New password")).toBeInTheDocument();
    expect(world.calls.myPreferences).toBe(0);
  });

  it("登出:本機快取保留", async () => {
    signedIn({ preferences: { locale: "en" } });

    const { user } = renderApp({ path: "/overview" });
    await openUserMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });

  it("同一台電腦換另一個帳號登入:換成那個帳號的語言,並覆寫本機快取", async () => {
    signedIn({ preferences: { locale: "en" } });

    const { user } = renderApp({ path: "/overview" });
    await openUserMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await screen.findByRole("button", { name: "Sign in" });

    // 換一個帳號(語言設定是中文)登入
    server.resetHandlers();
    server.use(...authWorld({ preferences: { locale: "zh-TW" } }).handlers);
    await user.type(screen.getByLabelText("Account"), "other");
    await user.type(screen.getByLabelText("Password"), "secret-1234");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("navigation", { name: "主選單" }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-TW");
  });

  it("切語言時寫入帳號失敗:畫面維持新語言、本機快取為新語言,跳失敗提示", async () => {
    signedIn({ preferences: { locale: "zh-TW" }, failPreferenceWrites: true });

    const { user } = renderApp({ path: "/overview" });
    await openUserMenu(user);
    await user.click(screen.getByRole("button", { name: "English" }));

    const alert = await findSnackbarAlert();
    expect(alert).toEqual({
      severity: "error",
      text: "Language switched, but it was not saved to your account; it will change back the next time you sign in",
    });
    const menu = screen.getByRole("dialog", { name: "User menu" });
    expect(
      within(menu).getByRole("button", { name: "English" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });

  it("連續快速切語言:寫入依序送出,帳號最後存的語言與畫面一致", async () => {
    const world = signedIn({ preferences: { locale: "zh-TW" } });
    let writes = 0;
    let completed = 0;
    // 第一次寫入(English)故意慢;沒有依序送出的話,它會比後送的「繁體中文」晚到、蓋掉帳號
    server.use(
      api.mutation("UpdateMyPreferences", async ({ variables }) => {
        writes += 1;
        if (writes === 1) {
          await delay(300);
        }
        const { settings } = (variables as UpdateMyPreferencesMutationVariables)
          .input;
        Object.assign(world.preferences, settings);
        completed += 1;
        return HttpResponse.json({
          data: { updateMyPreferences: { settings: { ...world.preferences } } },
        });
      }),
    );

    const { user } = renderApp({ path: "/overview" });
    await openUserMenu(user);
    await user.click(screen.getByRole("button", { name: "English" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "User menu" })).getByRole(
        "button",
        { name: "繁體中文" },
      ),
    );

    // 兩筆寫入都落地之後才看帳號(只等第二筆送出不夠:先送的那筆可能還在路上)
    await waitFor(() => {
      expect(completed).toBe(2);
    });
    expect(world.preferences.locale).toBe("zh-TW");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-TW");
    expect(
      screen.getByRole("dialog", { name: "使用者選單" }),
    ).toBeInTheDocument();
  });
});
