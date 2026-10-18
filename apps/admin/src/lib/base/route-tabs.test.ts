import { beforeEach, describe, expect, it } from "@jest/globals";

import { overviewModule } from "../../test/msw/auth-handlers";
import {
  sampleOneModules,
  systemModules,
} from "../../test/msw/module-fixtures";
import { enterableRouteMap } from "./module-tree";
import {
  EMPTY_TABS_ROUTE,
  type RouteTabEntry,
  closeEntry,
  closeItemEntries,
  moveEntry,
  readStoredEntries,
  resolveTabs,
  routeTabsStorageKey,
  setEntryItemLabel,
  syncEntries,
} from "./route-tabs";

const routes = enterableRouteMap([overviewModule, ...systemModules]);
const OVERVIEW = "/overview";
const ORG = "/system/org-manager";
const USER = "/system/user-manager";
const entriesOf = (...list: string[]): RouteTabEntry[] =>
  list.map((route) => ({ route }));
const routesOf = (entries: readonly RouteTabEntry[]) =>
  entries.map((entry) => entry.route);

describe("syncEntries(進入路由即生成、去重、剔除進不去的)", () => {
  it("目前路徑是模組路由且沒有 tab → 追加到最後", () => {
    expect(routesOf(syncEntries(entriesOf(OVERVIEW), routes, ORG))).toEqual([
      OVERVIEW,
      ORG,
    ]);
  });

  it("已有 tab 的路由不重複生成;順序不變", () => {
    expect(
      routesOf(syncEntries(entriesOf(ORG, OVERVIEW), routes, OVERVIEW)),
    ).toEqual([ORG, OVERVIEW]);
  });

  it("`/`、群組路由、不在集合內的路徑都不生成 tab", () => {
    expect(routesOf(syncEntries([], routes, "/"))).toEqual([]);
    expect(routesOf(syncEntries([], routes, "/system"))).toEqual([]);
    expect(routesOf(syncEntries([], routes, "/nope"))).toEqual([]);
  });

  it("進不去的路由(權限變了)被剔除", () => {
    expect(
      routesOf(
        syncEntries(entriesOf(OVERVIEW, "/demo/sample-two", ORG), routes, ORG),
      ),
    ).toEqual([OVERVIEW, ORG]);
  });
});

describe("詳情子頁籤(隱藏頁 + 尾端識別碼,與路由防守同一條判斷)", () => {
  const demoRoutes = enterableRouteMap([overviewModule, ...sampleOneModules]);
  const LIST = "/demo/sub/sample-one";
  const VIEW_1 = `${LIST}/view-page/demo-1`;
  const VIEW_2 = `${LIST}/view-page/demo-2`;

  it("syncEntries:每一筆各生成一個 tab(以完整網址去重)", () => {
    const once = syncEntries(entriesOf(LIST), demoRoutes, VIEW_1);
    expect(routesOf(once)).toEqual([LIST, VIEW_1]);
    expect(routesOf(syncEntries(once, demoRoutes, VIEW_1))).toEqual([
      LIST,
      VIEW_1,
    ]);
    expect(routesOf(syncEntries(once, demoRoutes, VIEW_2))).toEqual([
      LIST,
      VIEW_1,
      VIEW_2,
    ]);
  });

  it("syncEntries:列表(link)後面多一段、沒綁的隱藏頁都不生成;權限變了的子頁籤被剔除", () => {
    expect(routesOf(syncEntries([], demoRoutes, `${LIST}/demo-1`))).toEqual([]);
    const withoutView = enterableRouteMap(
      sampleOneModules.filter((module) => !module.key.endsWith(".view-page")),
    );
    expect(routesOf(syncEntries([], withoutView, VIEW_1))).toEqual([]);
    expect(
      routesOf(syncEntries(entriesOf(LIST, VIEW_1), withoutView, LIST)),
    ).toEqual([LIST]);
  });

  it("setEntryItemLabel:有 tab 換標籤、同名回同參考的紀錄;沒有 tab 帶標籤追加;空字串不動", () => {
    const entries = entriesOf(LIST, VIEW_1);
    const labelled = setEntryItemLabel(entries, VIEW_1, "醬燒雞腿排");
    expect(labelled).toEqual([
      { route: LIST },
      { route: VIEW_1, itemLabel: "醬燒雞腿排" },
    ]);
    expect(labelled[0]).toBe(entries[0]);

    const same = setEntryItemLabel(labelled, VIEW_1, "醬燒雞腿排");
    expect(same.every((entry, index) => entry === labelled[index])).toBe(true);

    expect(setEntryItemLabel(entriesOf(LIST), VIEW_2, "涼拌小黃瓜")).toEqual([
      { route: LIST },
      { route: VIEW_2, itemLabel: "涼拌小黃瓜" },
    ]);
    expect(setEntryItemLabel(entries, VIEW_1, "")).toEqual(entries);
  });

  it("resolveTabs:有標籤 →「所屬模組名 — 項目名」(隱藏頁取父模組);沒標籤 → 網址對上的模組名", () => {
    const tabs = resolveTabs(
      [
        { route: LIST },
        { route: VIEW_1, itemLabel: "醬燒雞腿排" },
        { route: VIEW_2 },
      ],
      demoRoutes,
    );
    expect(tabs.map((tab) => [tab.label, tab.moduleKey])).toEqual([
      ["示範模組1", "demo.sub.sample-one"],
      ["示範模組1 — 醬燒雞腿排", "demo.sub.sample-one.view-page"],
      ["示範項目詳情", "demo.sub.sample-one.view-page"],
    ]);
  });
});

describe("closeEntry(關閉當前 tab 切到相鄰)", () => {
  it("關閉非當前 tab:只移除,不轉向", () => {
    const result = closeEntry(entriesOf(OVERVIEW, ORG, USER), OVERVIEW, ORG);
    expect(routesOf(result.entries)).toEqual([ORG, USER]);
    expect(result.navigateTo).toBeNull();
  });

  it("關閉當前(中間)tab:切到右邊那個", () => {
    const result = closeEntry(entriesOf(OVERVIEW, ORG, USER), ORG, ORG);
    expect(routesOf(result.entries)).toEqual([OVERVIEW, USER]);
    expect(result.navigateTo).toBe(USER);
  });

  it("關閉當前(最右)tab:切到左邊那個", () => {
    const result = closeEntry(entriesOf(OVERVIEW, ORG, USER), USER, USER);
    expect(result.navigateTo).toBe(ORG);
  });

  it("關到一個都不剩:回首頁(由既有規則轉到側欄第一個能進的頁)", () => {
    const result = closeEntry(entriesOf(ORG), ORG, ORG);
    expect(result.entries).toEqual([]);
    expect(result.navigateTo).toBe(EMPTY_TABS_ROUTE);
  });

  it("關閉不存在的 tab:不動", () => {
    const result = closeEntry(entriesOf(ORG), USER, ORG);
    expect(routesOf(result.entries)).toEqual([ORG]);
    expect(result.navigateTo).toBeNull();
  });
});

describe("moveEntry(排序)", () => {
  it("往右移到目標位置", () => {
    expect(
      routesOf(moveEntry(entriesOf(OVERVIEW, ORG, USER), OVERVIEW, USER)),
    ).toEqual([ORG, USER, OVERVIEW]);
  });

  it("往左移到目標位置", () => {
    expect(
      routesOf(moveEntry(entriesOf(OVERVIEW, ORG, USER), USER, OVERVIEW)),
    ).toEqual([USER, OVERVIEW, ORG]);
  });

  it("任一路由不存在或相同:不動", () => {
    expect(
      routesOf(moveEntry(entriesOf(OVERVIEW, ORG), OVERVIEW, "/nope")),
    ).toEqual([OVERVIEW, ORG]);
    expect(routesOf(moveEntry(entriesOf(OVERVIEW, ORG), ORG, ORG))).toEqual([
      OVERVIEW,
      ORG,
    ]);
  });
});

describe("resolveTabs(名稱從模組陣列取)", () => {
  it("一般 tab 顯示模組名;itemLabel 有值時顯示「模組 — 項目名」(父模組不在集合內時用自己)", () => {
    const tabs = resolveTabs(
      [{ route: OVERVIEW }, { route: ORG, itemLabel: "台北店" }],
      routes,
    );
    expect(tabs.map((tab) => [tab.label, tab.moduleKey])).toEqual([
      ["總覽", "overview"],
      ["組織管理 — 台北店", "system.org-manager"],
    ]);
  });
});

describe("readStoredEntries(sessionStorage 讀回)", () => {
  const key = routeTabsStorageKey("user-1");

  beforeEach(() => {
    sessionStorage.clear();
  });

  it("壞掉或形狀不對的內容當作空,不丟例外", () => {
    sessionStorage.setItem(key, "{not json");
    expect(readStoredEntries(key)).toEqual([]);
    sessionStorage.setItem(key, JSON.stringify([{ route: 1 }, { route: ORG }]));
    expect(routesOf(readStoredEntries(key))).toEqual([ORG]);
  });
});

describe("closeItemEntries(刪除後關掉那一筆的子頁籤)", () => {
  const LIST = "/demo/sub/sample-one";
  const VIEW = `${LIST}/view-page`;
  const EDIT = `${LIST}/edit-page`;
  const itemRoutes = [`${VIEW}/demo-1`, `${EDIT}/demo-1`];
  const entries = entriesOf(
    LIST,
    `${VIEW}/demo-1`,
    `${EDIT}/demo-1`,
    `${VIEW}/demo-10`,
    `${VIEW}/demo-1/rev`,
  );

  it("以網址前綴比對:詳情、編輯與其下層都關掉;識別碼只是開頭相同的別筆不動", () => {
    const result = closeItemEntries(entries, itemRoutes, LIST, LIST);
    expect(routesOf(result.entries)).toEqual([LIST, `${VIEW}/demo-10`]);
  });

  it("不同模組、同一個 id 的子頁籤不受影響", () => {
    const OTHER_VIEW = "/demo/sub/sample-two/view-page";
    const result = closeItemEntries(
      entriesOf(`${VIEW}/demo-1`, `${OTHER_VIEW}/demo-1`),
      itemRoutes,
      LIST,
      LIST,
    );
    expect(routesOf(result.entries)).toEqual([`${OTHER_VIEW}/demo-1`]);
  });

  it("當前頁籤在其中 → 導向給定的列表頁(不切相鄰)", () => {
    expect(
      closeItemEntries(entries, itemRoutes, `${EDIT}/demo-1`, LIST).navigateTo,
    ).toBe(LIST);
  });

  it("當前頁籤不在其中 → 不導向", () => {
    expect(
      closeItemEntries(entries, itemRoutes, LIST, LIST).navigateTo,
    ).toBeNull();
    expect(
      closeItemEntries(entries, itemRoutes, null, LIST).navigateTo,
    ).toBeNull();
  });

  it("沒有對上的 → 內容不變", () => {
    const result = closeItemEntries(
      entriesOf(LIST),
      itemRoutes,
      LIST,
      EMPTY_TABS_ROUTE,
    );
    expect(result.entries).toEqual(entriesOf(LIST));
    expect(result.navigateTo).toBeNull();
  });
});
