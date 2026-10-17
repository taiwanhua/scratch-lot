import { beforeEach, describe, expect, it } from "@jest/globals";

import { enterableRouteMap } from "../../lib/base/module-tree";
import {
  type RouteTabEntry,
  readStoredEntries,
  routeTabsStorageKey,
} from "../../lib/base/route-tabs";
import { overviewModule } from "../../test/msw/auth-handlers";
import { systemModules } from "../../test/msw/module-fixtures";
import { useRouteTabsStore } from "./useRouteTabsStore";

const routes = enterableRouteMap([overviewModule, ...systemModules]);
const OVERVIEW = "/overview";
const ORG = "/system/org-manager";
const routesOf = (entries: readonly RouteTabEntry[]) =>
  entries.map((entry) => entry.route);

describe("useRouteTabsStore:sessionStorage 保留(以使用者分 key)", () => {
  const key = routeTabsStorageKey("user-1");

  beforeEach(() => {
    sessionStorage.clear();
  });

  it("每次變更都寫回;換綁使用者讀該使用者的 key,綁回來從 storage 讀回", () => {
    const { bind, sync, move } = useRouteTabsStore.getState();
    bind("user-1");
    sync(routes, OVERVIEW);
    sync(routes, ORG);
    move(OVERVIEW, ORG);

    expect(routesOf(readStoredEntries(key))).toEqual([ORG, OVERVIEW]);

    bind("user-2");
    expect(useRouteTabsStore.getState().entries).toEqual([]);

    bind("user-1");
    expect(routesOf(useRouteTabsStore.getState().entries)).toEqual([
      ORG,
      OVERVIEW,
    ]);
  });

  it("setItemLabel:寫回 sessionStorage(`[{ route, itemLabel }]`),同名不通知", () => {
    const { bind, sync, setItemLabel } = useRouteTabsStore.getState();
    bind("user-1");
    sync(routes, ORG);
    setItemLabel(ORG, "台北店");
    expect(readStoredEntries(key)).toEqual([
      { route: ORG, itemLabel: "台北店" },
    ]);

    let notified = 0;
    const unsubscribe = useRouteTabsStore.subscribe(() => {
      notified += 1;
    });
    setItemLabel(ORG, "台北店");
    expect(notified).toBe(0);
    unsubscribe();
  });

  it("沒變化不通知訂閱者(快照參考不變)", () => {
    const { bind, sync } = useRouteTabsStore.getState();
    bind("user-1");
    sync(routes, ORG);
    let notified = 0;
    const unsubscribe = useRouteTabsStore.subscribe(() => {
      notified += 1;
    });
    const before = useRouteTabsStore.getState().entries;
    sync(routes, ORG);
    expect(useRouteTabsStore.getState().entries).toBe(before);
    expect(notified).toBe(0);
    unsubscribe();
  });
});
