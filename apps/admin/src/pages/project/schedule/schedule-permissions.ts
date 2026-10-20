/** 班表管理的權限 key(seed 正本 `apps/db-migrator/seeds/project/schedule.ts`;規格 3.2)。 */
export const SCHEDULE_PERMISSIONS = {
  settingsView: "schedule.settings.view",
  editTemplates: "schedule.settings.edit-templates",
  editStaff: "schedule.settings.edit-staff",
  editDefaultRules: "schedule.settings.edit-default-rules",
  editOrgRules: "schedule.settings.edit-org-rules",
  manageView: "schedule.manage.view",
  editCalendar: "schedule.manage.edit-calendar",
  /** 「找不到人?」連到的使用者管理(有那個模組才顯示連結) */
  userManagerModule: "system.user-manager",
} as const;
