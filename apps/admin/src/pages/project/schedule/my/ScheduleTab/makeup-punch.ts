import { useNavigate } from "react-router";

import { useMyPendingMakeupPunchEntryIdsQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

import { useMakeupPunchHref } from "../../attendance/useMakeupPunchHref";

/** [申請補卡] 帶入的資料(規格 14.8:日期、分店、類型、對應排班;本人可以改)。 */
export interface MakeupPunchTarget {
  /** `YYYY-MM-DD` */
  date: string;
  orgId: string;
  /** 缺的第一張卡:`in` 上班 / `out` 下班 */
  type: "in" | "out";
  entryId: string;
}

export interface MakeupPunchLink {
  /** 打開補打卡新增頁(帶入資料) */
  open: (target: MakeupPunchTarget) => void;
  /** 這一班已送出、還在審核中的補卡(顯示「補卡審核中」,不再顯示 [申請補卡]) */
  isPending: (entryId: string) => boolean;
}

/**
 * `useMakeupPunchLink()`(規格 14.6「每列附 [申請補卡](帶入資料),已送出的顯示「補卡審核中」」):
 * 連到出勤紀錄的補打卡新增頁(帶入日期、分店、類型、對應排班);還在審核中的那一班顯示「補卡審核中」。
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
    open: (target) => {
      void navigate(hrefOf(target));
    },
    isPending: (entryId) => pendingIds.has(entryId),
  };
};
