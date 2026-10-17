import { beforeEach, describe, expect, it } from "@jest/globals";

import { projectPublic } from "@repo/project-config/public";

import {
  LEGACY_SIDE_NAV_STORAGE_KEY,
  SIDE_NAV_STORAGE_KEY,
  createSideNavItemReader,
  useSideNavStore,
} from "./useSideNavStore";

/** `persist` 預設的封包格式(#289 存下來的既存值就長這樣)。 */
const envelope = (isCollapsed: boolean) =>
  JSON.stringify({ state: { isCollapsed }, version: 0 });

/**
 * 模擬「關掉分頁再打開」:store 是模組層單例,記憶體只能自己歸零。
 * `setState` 會經過 `persist` 順手寫一次 storage,所以歸零**之後**才佈置這次要讀的值
 * (與 `SideNav.test.tsx` 的重新整理同一招)。
 */
const reloadWith = async (current: string | null): Promise<void> => {
  useSideNavStore.setState({ isCollapsed: false });
  localStorage.clear();
  if (current !== null) {
    localStorage.setItem(SIDE_NAV_STORAGE_KEY, current);
  }
  await useSideNavStore.persist.rehydrate();
};

/**
 * 正式的 store 單例 + 目前的專案設定。這裡不寫任何專案的字面鍵(換專案不必改本檔);
 * CookHome 歷史鍵與舊鍵搬移在 `useSideNavStore.legacy-project.test.ts` 以固定設定驗。
 */
describe("useSideNavStore:鍵來自目前的專案設定", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("key 是 `<slug>-admin-sidenav`;舊鍵就是專案設定指定的那一把(或 null)", () => {
    expect(SIDE_NAV_STORAGE_KEY).toBe(`${projectPublic.slug}-admin-sidenav`);
    expect(LEGACY_SIDE_NAV_STORAGE_KEY).toBe(
      projectPublic.compatibility.legacySideNavStorageKey,
    );
  });

  it("已存的收合狀態讀得回來;改狀態寫回同一把 key,格式是 persist 的封包", async () => {
    await reloadWith(envelope(true));
    expect(useSideNavStore.getState().isCollapsed).toBe(true);

    useSideNavStore.getState().toggle();
    expect(localStorage.getItem(SIDE_NAV_STORAGE_KEY)).toBe(
      '{"state":{"isCollapsed":false},"version":0}',
    );

    await reloadWith(envelope(false));
    expect(useSideNavStore.getState().isCollapsed).toBe(false);
  });

  it("沒有值時退回預設的展開態", async () => {
    await reloadWith(null);

    expect(useSideNavStore.getState().isCollapsed).toBe(false);
  });
});

describe("createSideNavItemReader:舊鍵由專案設定決定", () => {
  const NEW_KEY = "other-admin-sidenav";
  // 別的專案留在同一個瀏覽器裡的鍵(固定字面值,與目前的專案設定無關)
  const FOREIGN_KEY = "cookhome-admin-sidenav";
  const FOREIGN_LEGACY_KEY = "cookhome.admin.sidenav";

  beforeEach(() => {
    localStorage.clear();
  });

  it("沒有舊鍵的專案(null):新鍵缺值就回 null,不讀也不刪別的專案的舊鍵", () => {
    localStorage.setItem(FOREIGN_LEGACY_KEY, envelope(true));
    localStorage.setItem(FOREIGN_KEY, envelope(true));

    expect(createSideNavItemReader(null)(NEW_KEY)).toBeNull();

    expect(localStorage.getItem(NEW_KEY)).toBeNull();
    expect(localStorage.getItem(FOREIGN_LEGACY_KEY)).toBe(envelope(true));
    expect(localStorage.getItem(FOREIGN_KEY)).toBe(envelope(true));
  });

  it("指定舊鍵的專案:新鍵缺值才搬,搬後刪舊鍵", () => {
    localStorage.setItem("other.admin.sidenav", envelope(true));

    expect(createSideNavItemReader("other.admin.sidenav")(NEW_KEY)).toBe(
      envelope(true),
    );

    expect(localStorage.getItem(NEW_KEY)).toBe(envelope(true));
    expect(localStorage.getItem("other.admin.sidenav")).toBeNull();
  });

  it("指定舊鍵的專案:新鍵已有值就不看舊鍵,舊鍵原樣留著", () => {
    localStorage.setItem(NEW_KEY, envelope(false));
    localStorage.setItem("other.admin.sidenav", envelope(true));

    expect(createSideNavItemReader("other.admin.sidenav")(NEW_KEY)).toBe(
      envelope(false),
    );

    expect(localStorage.getItem("other.admin.sidenav")).toBe(envelope(true));
  });
});
