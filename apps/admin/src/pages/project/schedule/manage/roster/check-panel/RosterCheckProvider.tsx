import { type ReactNode, useEffect, useRef, useState } from "react";

import { useScheduleCheckQuery } from "@repo/graphql";
import { useBreakpointDown } from "@repo/ui/media-query";

import { useSession } from "@/hooks/base/useSession";
import { useSideNavStore } from "@/stores/base/useSideNavStore";

import { PublishDialog } from "../publish/PublishDialog";
import {
  ROSTER_QUERY_ROOT,
  type RosterCellTarget,
  type RosterData,
} from "../roster-context";
import {
  RosterCheckContext,
  type RosterCheckContextValue,
} from "./roster-check-context";

/**
 * 「側欄是面板收的」記在這個分頁的 sessionStorage:面板開著時重新整理(effect 的還原沒機會跑),
 * 下次進排班表時照這個記號把側欄展開回去,側欄偏好不會被面板汙染。
 */
export const NAV_COLLAPSED_BY_CHECK_KEY = "schedule.roster.check-collapsed-nav";

const readMark = (): boolean => {
  try {
    return sessionStorage.getItem(NAV_COLLAPSED_BY_CHECK_KEY) === "1";
  } catch {
    return false;
  }
};

const writeMark = (collapsed: boolean): void => {
  try {
    if (collapsed) {
      sessionStorage.setItem(NAV_COLLAPSED_BY_CHECK_KEY, "1");
    } else {
      sessionStorage.removeItem(NAV_COLLAPSED_BY_CHECK_KEY);
    }
  } catch {
    // sessionStorage 不可用:只是重新整理後不會自動展開回去
  }
};

/** 上次面板收了側欄、還沒還原就離開(重新整理)→ 展開回去。 */
const restoreNavFromMark = (): void => {
  if (!readMark()) {
    return;
  }
  writeMark(false);
  const nav = useSideNavStore.getState();
  if (nav.isCollapsed) {
    nav.toggle();
  }
};

export interface RosterCheckProviderProps {
  data: RosterData | undefined;
  month: string;
  scrollToCell: (target: RosterCellTarget) => void;
  children: ReactNode;
}

/**
 * 排班表頁的檢核狀態(規格 14.5「檢核面板」):
 *
 * - 檢核結果的查詢 key 掛在排班表的前綴下(`ROSTER_QUERY_ROOT`):任何寫入讓排班表失效時一起重查,改完即時更新
 * - 發布確認視窗也畫在這裡([⋯] 選單裡的 [發布] 關掉選單後視窗照樣開著)
 * - 面板打開時,電腦 / 平板的側欄自動收合成圖示列(是面板收的才在關上時展開回去;本來就收著的不動)
 */
export const RosterCheckProvider = ({
  data,
  month,
  scrollToCell,
  children,
}: RosterCheckProviderProps) => {
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const [isOpen, setOpen] = useState(false);
  const [isPublishing, setPublishing] = useState(false);
  const variables = {
    input: { month, ...(data === undefined ? {} : { orgId: data.orgId }) },
  };
  const query = useScheduleCheckQuery(session.client, variables, {
    queryKey: [...ROSTER_QUERY_ROOT, "check", variables],
    enabled: data !== undefined,
  });

  // 面板打開 → 側欄收成圖示列(外部的側欄狀態;關上時還原我們收的那一次)
  const collapsedByPanel = useRef(false);
  useEffect(() => {
    restoreNavFromMark();
  }, []);
  useEffect(() => {
    if (!isOpen || isMobile) {
      return;
    }
    const nav = useSideNavStore.getState();
    if (!nav.isCollapsed) {
      nav.toggle();
      collapsedByPanel.current = true;
      writeMark(true);
    }
    return () => {
      if (collapsedByPanel.current && useSideNavStore.getState().isCollapsed) {
        useSideNavStore.getState().toggle();
      }
      collapsedByPanel.current = false;
      writeMark(false);
    };
  }, [isOpen, isMobile]);

  const value: RosterCheckContextValue = {
    data,
    month,
    check: query.data?.scheduleCheck,
    isChecking: query.isFetching,
    isCheckError: query.isError,
    isOpen,
    setOpen,
    openPublish: () => {
      setPublishing(true);
    },
    scrollToCell,
  };
  return (
    <RosterCheckContext value={value}>
      {children}
      {isPublishing && data !== undefined && (
        <PublishDialog
          onClose={() => {
            setPublishing(false);
          }}
        />
      )}
    </RosterCheckContext>
  );
};
