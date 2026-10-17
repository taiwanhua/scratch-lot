import { beforeEach, describe, expect, it } from "@jest/globals";

import {
  SIDE_NAV_STORAGE_KEY as CONFIGURED_KEY,
  LEGACY_SIDE_NAV_STORAGE_KEY as CONFIGURED_LEGACY_KEY,
  useSideNavStore,
} from "./useSideNavStore";

/**
 * 以固定的 CookHome 設定跑(jest 的 `legacy-project`):正式的 store 單例 + 歷史字面鍵。
 * 守的是既有瀏覽器裡的收合狀態 —— 點分隔舊鍵搬到 kebab 新鍵的行為不因抽出專案設定而變。
 */
const SIDE_NAV_STORAGE_KEY = "cookhome-admin-sidenav";
const LEGACY_SIDE_NAV_STORAGE_KEY = "cookhome.admin.sidenav";

/** `persist` 預設的封包格式(#289 存下來的既存值就長這樣)。 */
const envelope = (isCollapsed: boolean) =>
  JSON.stringify({ state: { isCollapsed }, version: 0 });

/**
 * 模擬「關掉分頁再打開」:store 是模組層單例,記憶體只能自己歸零。
 * `setState` 會經過 `persist` 順手寫一次 storage,所以歸零**之後**才佈置這次要讀的兩把 key
 * (與 `SideNav.test.tsx` 的重新整理同一招)。
 */
const reloadWith = async (stored: {
  current?: string;
  legacy?: string;
}): Promise<void> => {
  useSideNavStore.setState({ isCollapsed: false });
  localStorage.clear();
  if (stored.current !== undefined) {
    localStorage.setItem(SIDE_NAV_STORAGE_KEY, stored.current);
  }
  if (stored.legacy !== undefined) {
    localStorage.setItem(LEGACY_SIDE_NAV_STORAGE_KEY, stored.legacy);
  }
  await useSideNavStore.persist.rehydrate();
};

describe("useSideNavStore(CookHome 歷史鍵):localStorage key 統一為 kebab(#183 第 6 項)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("key 是 kebab,與 admin 其餘儲存鍵同一套寫法;舊鍵是點分隔", () => {
    expect(CONFIGURED_KEY).toBe("cookhome-admin-sidenav");
    expect(CONFIGURED_LEGACY_KEY).toBe("cookhome.admin.sidenav");
  });

  it("只有舊 key 有值時搬到新 key 並刪掉舊的,收合狀態不會因為改名而掉", async () => {
    await reloadWith({ legacy: envelope(true) });

    expect(useSideNavStore.getState().isCollapsed).toBe(true);
    expect(localStorage.getItem(SIDE_NAV_STORAGE_KEY)).toBe(envelope(true));
    // 搬移只做一次:舊 key 當場刪掉,之後每次啟動都只讀新 key
    expect(localStorage.getItem(LEGACY_SIDE_NAV_STORAGE_KEY)).toBeNull();
  });

  it("搬移後在新 key 上改狀態,下次啟動讀回的是新值", async () => {
    await reloadWith({ legacy: envelope(true) });

    useSideNavStore.getState().toggle();
    expect(localStorage.getItem(SIDE_NAV_STORAGE_KEY)).toBe(envelope(false));

    await reloadWith({ current: envelope(false) });
    expect(useSideNavStore.getState().isCollapsed).toBe(false);
  });

  it("新 key 已有值時不看舊 key(舊 key 的殘值不覆蓋新值)", async () => {
    await reloadWith({ current: envelope(false), legacy: envelope(true) });

    expect(useSideNavStore.getState().isCollapsed).toBe(false);
    // 沒搬移就不動舊 key:這條路徑只在新 key 空的時候才會走
    expect(localStorage.getItem(LEGACY_SIDE_NAV_STORAGE_KEY)).toBe(
      envelope(true),
    );
  });

  it("兩把 key 都沒有值時退回預設的展開態", async () => {
    await reloadWith({});

    expect(useSideNavStore.getState().isCollapsed).toBe(false);
  });
});
