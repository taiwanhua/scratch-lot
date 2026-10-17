import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { z } from "zod";

import { useUrlState } from "@/hooks/base/useUrlState";
import { type RouteTabEntry, routeTabsStorageKey } from "@/lib/base/route-tabs";
import { authWorld, testUser } from "@/test/msw/auth-handlers";
import { superAdminModules } from "@/test/msw/module-fixtures";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

/**
 * 規格 10.1「頁籤(RouteTabs)記住網址參數」情境表:每一列一個測試。
 * 頁面的篩選以掛在殼旁邊的 `FilterProbe` 代表(它和頁面一樣經 `useUrlState` 讀寫目前網址的 `?list=`),
 * 這樣測的是殼與頁籤的行為,不綁某一頁的版面。
 */

const STORAGE_KEY = routeTabsStorageKey(testUser.id);
const OVERVIEW = "/overview";
const ORG = "/system/org-manager";
const DONE = `?list=${encodeURIComponent('{"status":"done"}')}`;
/** 篩選寫進網址後的樣子(nuqs 只把 `"` 編碼,`{`、`:` 留著可讀)。 */
const WRITTEN = "?list={%22status%22:%22done%22}";

const listSchema = z
  .object({ status: z.enum(["all", "done"]).default("all") })
  .default({ status: "all" });

const FilterProbe = () => {
  const [list, setList] = useUrlState("list", listSchema);
  return (
    <>
      <output data-testid="filter">{list.status}</output>
      <button
        type="button"
        onClick={() => {
          setList({ status: "done" });
        }}
      >
        只看完成
      </button>
      <button
        type="button"
        onClick={() => {
          setList({ status: "all" });
        }}
      >
        全部
      </button>
    </>
  );
};

/** 頁面跟著路由掛載 / 卸載:探針以路徑當 key,換頁就是新的一份(與真的頁面一樣在掛載時讀網址)。 */
const RoutedFilterProbe = () => {
  const { pathname } = useLocation();
  return <FilterProbe key={pathname} />;
};

const renderShell = (path: string) => {
  server.use(
    ...authWorld({ hasRefreshCookie: true, modules: superAdminModules })
      .handlers,
  );
  return renderApp({ path, extra: <RoutedFilterProbe /> });
};

const findTabList = async () =>
  screen.findByRole("tablist", { name: "路由頁籤" });

const tabLabels = (list: HTMLElement) =>
  within(list)
    .queryAllByRole("tab")
    .map((tab) => tab.textContent);

const sideNavLink = (name: string) =>
  within(screen.getByRole("navigation", { name: "主選單" })).getByRole("link", {
    name,
  });

const location = () => screen.getByTestId("location").textContent;
const filter = () => screen.getByTestId("filter").textContent;

const storedEntries = (): RouteTabEntry[] =>
  JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]") as RouteTabEntry[];

const storedSearchOf = (route: string) =>
  storedEntries().find((entry) => entry.route === route)?.search;

beforeEach(() => {
  sessionStorage.clear();
});

describe("RouteTabs:頁籤記住網址參數(規格 10.1 情境表)", () => {
  it("改篩選條件 → 網址參數以 replace 更新,頁籤同步記下「路徑 + 參數」", async () => {
    const { user } = renderShell(OVERVIEW);
    await findTabList();
    const historyLength = globalThis.history.length;

    await user.click(screen.getByRole("button", { name: "只看完成" }));

    await waitFor(() => {
      expect(location()).toBe(`${OVERVIEW}${WRITTEN}`);
    });
    await waitFor(() => {
      expect(storedSearchOf(OVERVIEW)).toBe(WRITTEN);
    });
    expect(globalThis.history).toHaveLength(historyLength);
  });

  it("切到別的頁籤再切回來 → 恢復該頁籤記下的參數", async () => {
    const { user } = renderShell(OVERVIEW);
    const list = await findTabList();
    await user.click(screen.getByRole("button", { name: "只看完成" }));
    // 等寫入真的進了網址(nuqs 會把連續寫入合併後才送出)
    await waitFor(() => {
      expect(storedSearchOf(OVERVIEW)).toBe(WRITTEN);
    });

    await user.click(sideNavLink("組織管理"));
    await waitFor(() => {
      expect(location()).toBe(ORG);
    });
    await waitFor(() => {
      expect(filter()).toBe("all");
    });

    await user.click(within(list).getByRole("tab", { name: "總覽" }));

    await waitFor(() => {
      expect(location()).toBe(`${OVERVIEW}${WRITTEN}`);
    });
    await waitFor(() => {
      expect(filter()).toBe("done");
    });
  });

  it("重新整理(F5)→ 條件還在(參數在網址上)", async () => {
    const first = renderShell(OVERVIEW);
    await findTabList();
    await first.user.click(screen.getByRole("button", { name: "只看完成" }));
    await waitFor(() => {
      expect(location()).toBe(`${OVERVIEW}${WRITTEN}`);
    });
    const reloadUrl = `${globalThis.location.pathname}${globalThis.location.search}`;
    first.unmount();

    renderShell(reloadUrl);

    const list = await findTabList();
    expect(filter()).toBe("done");
    expect(tabLabels(list)).toEqual(["總覽"]);
    expect(storedSearchOf(OVERVIEW)).toBe(WRITTEN);
  });

  it("關閉頁籤,再從側欄打開 → 回到預設條件(側欄連結不帶參數)", async () => {
    const { user } = renderShell(OVERVIEW);
    const list = await findTabList();
    await user.click(screen.getByRole("button", { name: "只看完成" }));
    await waitFor(() => {
      expect(storedSearchOf(OVERVIEW)).toBe(WRITTEN);
    });
    await user.click(sideNavLink("組織管理"));
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["總覽", "組織管理"]);
    });

    await user.click(within(list).getByRole("button", { name: "關閉 總覽" }));
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["組織管理"]);
    });
    expect(sideNavLink("總覽")).toHaveAttribute("href", OVERVIEW);
    await user.click(sideNavLink("總覽"));

    await waitFor(() => {
      expect(location()).toBe(OVERVIEW);
    });
    await waitFor(() => {
      expect(filter()).toBe("all");
    });
    expect(storedSearchOf(OVERVIEW)).toBeUndefined();
  });

  it("頁籤已開著,從側欄點同一頁 → 切到那個頁籤,恢復它記下的參數", async () => {
    const { user } = renderShell(OVERVIEW);
    await findTabList();
    await user.click(screen.getByRole("button", { name: "只看完成" }));
    await waitFor(() => {
      expect(storedSearchOf(OVERVIEW)).toBe(WRITTEN);
    });
    await user.click(sideNavLink("組織管理"));
    await waitFor(() => {
      expect(location()).toBe(ORG);
    });

    await user.click(sideNavLink("總覽"));

    await waitFor(() => {
      expect(location()).toBe(`${OVERVIEW}${WRITTEN}`);
    });
    await waitFor(() => {
      expect(filter()).toBe("done");
    });
  });

  it("條件等於預設值 → 網址不寫那個 key(與側欄連結相同)", async () => {
    const { user } = renderShell(OVERVIEW);
    await findTabList();
    await user.click(screen.getByRole("button", { name: "只看完成" }));
    await waitFor(() => {
      expect(location()).toBe(`${OVERVIEW}${WRITTEN}`);
    });

    await user.click(screen.getByRole("button", { name: "全部" }));

    await waitFor(() => {
      expect(location()).toBe(OVERVIEW);
    });
    await waitFor(() => {
      expect(storedSearchOf(OVERVIEW)).toBeUndefined();
    });
    expect(sideNavLink("總覽")).toHaveAttribute("href", OVERVIEW);
  });

  it("用帶參數的網址打開、這個路徑的頁籤已經開著 → 頁籤改成網址上的條件,不另開第二個", async () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { route: OVERVIEW, search: `?list={"status":"all","old":1}` },
        { route: ORG },
      ]),
    );

    renderShell(`${OVERVIEW}${DONE}`);

    const list = await findTabList();
    await waitFor(() => {
      expect(storedSearchOf(OVERVIEW)).toBe(DONE);
    });
    expect(tabLabels(list)).toEqual(["總覽", "組織管理"]);
    expect(filter()).toBe("done");
  });

  it("用帶參數的網址打開、頁籤還沒開 → 開新頁籤,套用網址上的條件", async () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([{ route: ORG }]));

    renderShell(`${OVERVIEW}${DONE}`);

    const list = await findTabList();
    await waitFor(() => {
      expect(tabLabels(list)).toEqual(["組織管理", "總覽"]);
    });
    expect(storedSearchOf(OVERVIEW)).toBe(DONE);
    expect(filter()).toBe("done");
  });

  it("參數格式錯誤或舊格式 → 退回預設條件,以 replace 清掉那一個 key;頁籤記下的參數同步清掉", async () => {
    const broken = `?keep=1&list=${encodeURIComponent('{"status":"hacked"}')}`;
    renderShell(`${OVERVIEW}${broken}`);
    await findTabList();
    const historyLength = globalThis.history.length;

    expect(filter()).toBe("all");
    await waitFor(() => {
      expect(location()).toBe(`${OVERVIEW}?keep=1`);
    });
    await waitFor(() => {
      expect(storedSearchOf(OVERVIEW)).toBe("?keep=1");
    });
    expect(globalThis.history).toHaveLength(historyLength);
  });

  it("頁籤狀態的保存:沿用同一把 sessionStorage key,每個頁籤多存 search;舊格式(沒有 search)照樣讀得回來", async () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([{ route: ORG }]));
    const { user } = renderShell(OVERVIEW);
    const list = await findTabList();
    expect(tabLabels(list)).toEqual(["組織管理", "總覽"]);

    await user.click(screen.getByRole("button", { name: "只看完成" }));

    await waitFor(() => {
      expect(storedEntries()).toEqual([
        { route: ORG },
        { route: OVERVIEW, search: WRITTEN },
      ]);
    });
    // 只有這一把 key(不另建儲存)
    expect(
      Object.keys(sessionStorage).filter((key) => key.includes("route-tabs")),
    ).toEqual([STORAGE_KEY]);
  });
});
