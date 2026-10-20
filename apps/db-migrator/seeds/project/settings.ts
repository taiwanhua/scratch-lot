import type { ProjectSeedSettings } from "../base/seed-source";

/**
 * 專案的種子初值(正本:ADR-0002)。這些是**初始值**:建立時寫入,之後保留人在後台的修改,
 * 完整清庫還原才重建為這裡的值。
 *
 * - `rootOrg`:根組織的顯示名稱、說明與 settings(名稱是品牌文字,改動要同步 docs/project/branding.md)
 * - `moduleInitialValues`:既有模組的初值指定,以模組 key 為鍵,只收 `enabled`、`icon`、`settings`
 */
/** 支援需求單(`support_request`)的一個表單欄位欄。 */
function supportRequestColumn(key: string, width: number, order: number) {
  return { kind: "field", key, formKey: "support_request", width, order };
}

export const projectSeedSettings: ProjectSeedSettings = {
  rootOrg: {
    name: "scratch-lot",
    description: "平台營運者(根組織)",
    settings: {},
  },
  moduleInitialValues: {
    // 排班作業 → 支援需求單的列表欄位配置(規格 14.10;Figma SC-31):日期、開始、結束、崗位、需要人數、分店
    // + 內建欄「狀態」。初始 seed 值:模組的 settings 已存在就不覆寫,之後由平台管理員在「模組與權限」調整。
    // 注意:這裡的 settings 會整份取代 P06 在 `schedule.ts` 宣告裡的 `settings`(初值不逐鍵合併)
    "schedule.manage": {
      settings: {
        list: {
          columns: [
            supportRequestColumn("date", 120, 0),
            supportRequestColumn("start_time", 100, 1),
            supportRequestColumn("end_time", 100, 2),
            supportRequestColumn("position", 140, 3),
            supportRequestColumn("headcount", 100, 4),
            supportRequestColumn("branch", 140, 5),
          ],
          builtin: { form: false, status: true, createdBy: false },
        },
      },
    },
  },
};
