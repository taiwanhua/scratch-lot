/**
 * 排班候選人(規格 14.3):有排班檔案、啟用、可以排的分店包含這家店的人。
 * 手動排班與自動排班用同一份名單 —— 由 `ScheduleStaffService.listScheduleCandidates(operator, orgId, at?)` 提供。
 */
export interface ScheduleCandidate {
  staffId: string;
  userId: string;
  name: string;
  /** `full-time` / `part-time` */
  employmentType: string;
  /** 這家店可擔任負責人 */
  canLead: boolean;
  /** 這家店是他的主要分店 */
  isPrimary: boolean;
  sortOrder: number;
}
