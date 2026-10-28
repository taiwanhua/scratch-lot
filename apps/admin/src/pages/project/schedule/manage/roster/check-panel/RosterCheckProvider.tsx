import { type ReactNode, useEffect, useRef, useState } from "react";

import { useScheduleCheckQuery } from "@repo/graphql";
import { useBreakpointDown } from "@repo/ui/media-query";

import { useSession } from "@/hooks/base/useSession";

import { RosterPublishDialog } from "../publish/RosterPublishDialog";
import {
  ROSTER_QUERY_ROOT,
  type RosterCellTarget,
  type RosterData,
} from "../roster-context";
import { ROSTER_TOOLBAR_DIALOGS } from "../roster-toolbar-dialogs";
import {
  RosterCheckContext,
  type RosterCheckContextValue,
} from "./roster-check-context";
import {
  collapseNavForPanel,
  restoreNavAfterPanel,
  restoreNavFromMark,
} from "./side-nav-mark";

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
 * - 發布確認視窗與工具列功能登記的對話框(`roster-toolbar-dialogs.ts`)也畫在這裡([⋯] 選單關掉後照樣開著)
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
  const [dialogKey, setDialogKey] = useState<string | null>(null);
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
    collapsedByPanel.current = collapseNavForPanel();
    return () => {
      restoreNavAfterPanel(collapsedByPanel.current);
      collapsedByPanel.current = false;
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
    openDialog: setDialogKey,
    scrollToCell,
  };
  return (
    <RosterCheckContext value={value}>
      {children}
      {isPublishing && data !== undefined && (
        <RosterPublishDialog
          onClose={() => {
            setPublishing(false);
          }}
        />
      )}
      {data !== undefined &&
        ROSTER_TOOLBAR_DIALOGS.filter((item) => item.key === dialogKey).map(
          ({ key, Dialog }) => (
            <Dialog
              key={key}
              onClose={() => {
                setDialogKey(null);
              }}
            />
          ),
        )}
    </RosterCheckContext>
  );
};
