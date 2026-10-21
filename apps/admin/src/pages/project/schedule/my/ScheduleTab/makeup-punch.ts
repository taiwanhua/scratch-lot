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
 * 介面 `useMakeupPunchLink()`(規格 14.6「每列附 [申請補卡](帶入資料),已送出的顯示「補卡審核中」」):
 * 我的班表的打卡不完整提醒與當天詳情的顯示位置已經接好,補打卡申請(出勤紀錄)併回前一律回 null,
 * 畫面不顯示 [申請補卡]。實作時只改這支(改成連到補打卡新增頁的 hook),我的班表不必動。
 */
export const useMakeupPunchLink: () => MakeupPunchLink | null = () => null;
