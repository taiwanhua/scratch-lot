import { useEffect, useState } from "react";

import {
  type SectionPageStates,
  isSectionCollapsed,
  pruneSectionPage,
  readSectionStore,
  sectionsStorageKey,
  setSectionCollapsed,
  writeSectionStore,
} from "@/lib/base/section-collapse";

import { useMe } from "./useMe";

export interface SectionCollapseApi {
  /** 某區塊目前是否收合(有紀錄用紀錄,沒有用預設值) */
  isCollapsed: (sectionKey: string, defaultCollapsed: boolean) => boolean;
  /** 使用者手動切換:更新畫面,並寫進儲存(只記與預設不同的) */
  setCollapsed: (
    sectionKey: string,
    collapsed: boolean,
    defaultCollapsed: boolean,
  ) => void;
}

interface Snapshot {
  storageKey: string | null;
  pageId: string | null;
  page: SectionPageStates;
}

const readPage = (storageKey: string | null, pageId: string | null) =>
  storageKey === null || pageId === null
    ? {}
    : (readSectionStore(storageKey)[pageId] ?? {});

/**
 * 一頁可收合區塊的收合狀態(底座 10.3;規則與儲存格式在 `lib/base/section-collapse.ts`)。
 *
 * - `pageId` 為 null = 不記憶(例:設計器預覽,草稿的分區不該動到正式表單的紀錄):只用預設值與這次的手動切換
 * - 儲存 key 依登入者分把(`me.id`);還沒有登入者時一律用預設值、不寫入
 * - 進頁時讀一次;換使用者或換頁面 id 時重讀(render 期依 props 調整 state,不在 effect 裡 setState,REACT-06)
 * - 給了 `sectionKeys`(這一頁現有的全部區塊 key)就在打開時清掉該頁已不存在的紀錄;
 *   一般頁面的 `Section` 只管自己那一塊,不清
 * - 切換時畫面以元件 state 為準,localStorage 不可用也照常收合 / 展開,只是不記住
 */
export const useSectionCollapse = (
  pageId: string | null,
  sectionKeys?: readonly string[],
): SectionCollapseApi => {
  const userId = useMe().data?.me.id ?? null;
  const storageKey = userId === null ? null : sectionsStorageKey(userId);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    storageKey,
    pageId,
    page: readPage(storageKey, pageId),
  }));
  if (snapshot.storageKey !== storageKey || snapshot.pageId !== pageId) {
    setSnapshot({ storageKey, pageId, page: readPage(storageKey, pageId) });
  }

  const keysSignature = sectionKeys?.join("\n");
  useEffect(() => {
    if (storageKey === null || pageId === null || keysSignature === undefined) {
      return;
    }
    const store = readSectionStore(storageKey);
    const pruned = pruneSectionPage(store, pageId, keysSignature.split("\n"));
    if (pruned !== store) {
      writeSectionStore(storageKey, pruned);
    }
  }, [storageKey, pageId, keysSignature]);

  return {
    isCollapsed: (sectionKey, defaultCollapsed) =>
      isSectionCollapsed(snapshot.page, sectionKey, defaultCollapsed),
    setCollapsed: (sectionKey, collapsed, defaultCollapsed) => {
      // 畫面:這一頁的紀錄照同一條規則更新(改回預設就刪)
      const local = setSectionCollapsed(
        { page: snapshot.page },
        "page",
        sectionKey,
        collapsed,
        defaultCollapsed,
      );
      setSnapshot({ storageKey, pageId, page: local.page ?? {} });
      if (storageKey === null || pageId === null) {
        return;
      }
      // 儲存:以最新的整把 key 為底(別頁、別的分頁可能剛寫過)
      writeSectionStore(
        storageKey,
        setSectionCollapsed(
          readSectionStore(storageKey),
          pageId,
          sectionKey,
          collapsed,
          defaultCollapsed,
        ),
      );
    },
  };
};
