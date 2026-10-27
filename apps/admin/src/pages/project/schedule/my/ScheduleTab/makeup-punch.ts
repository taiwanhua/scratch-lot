import { useNavigate } from "react-router";

import { useMyPendingMakeupPunchEntryIdsQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

import {
  makeupPrefillOf,
  useMakeupPunchHref,
} from "../../attendance/useMakeupPunchHref";

/** [申請補卡] 的那一班(缺卡;帶入補打卡時間、分店、類型、對應排班,本人可以改;規格 14.8)。 */
export interface MakeupPunchTarget {
  id: string;
  orgId: string;
  startAt: string;
  endAt: string;
  missing: readonly string[];
}

export interface MakeupPunchLink {
  /** 打開補打卡新增頁(帶入資料) */
  open: (entry: MakeupPunchTarget) => void;
  /** 這一班已送出、還在審核中的補卡(顯示「補卡審核中」,不再顯示 [申請補卡]) */
  isPending: (entryId: string) => boolean;
}

/**
 * `useMakeupPunchLink()`(規格 14.6「每列附 [申請補卡](帶入資料),已送出的顯示「補卡審核中」」):
 * 連到出勤紀錄的補打卡新增頁(帶入補打卡時間、分店、類型、對應排班;`makeupPrefillOf`);還在審核中的那一班顯示「補卡審核中」。
 * 沒有 `schedule.attendance.create` 或沒綁新增頁 → null(畫面不顯示 [申請補卡])。
 */
export const useMakeupPunchLink = (): MakeupPunchLink | null => {
  const navigate = useNavigate();
  const { session } = useSession();
  const hrefOf = useMakeupPunchHref();
  const pending = useMyPendingMakeupPunchEntryIdsQuery(
    session.client,
    undefined,
    {
      enabled: hrefOf !== null,
    },
  );
  if (hrefOf === null) {
    return null;
  }
  const pendingIds = new Set(pending.data?.myPendingMakeupPunchEntryIds);
  return {
    open: (entry) => {
      void navigate(hrefOf(makeupPrefillOf({ ...entry, entryId: entry.id })));
    },
    isPending: (entryId) => pendingIds.has(entryId),
  };
};
