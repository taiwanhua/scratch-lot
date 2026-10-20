import { formModuleDeclaration } from "../base/form-module-declaration";
import {
  type ModuleSeedDeclaration,
  type PermissionDeclaration,
  permissionKey,
} from "../base/module-declaration";

/**
 * 班表管理(群組)與四個子模組(規格 3.1、3.2;正本 `docs/modules/project/schedule.md`)。
 * 一次宣告整個模組的全部權限,之後同模組的功能只寫程式、不改這份宣告。
 *
 * - `schedule.my` 我的班表、`schedule.settings` 排班設定:固定頁(頁內分頁)
 * - `schedule.manage` 排班作業(綁定 支援需求單)、`schedule.attendance` 出勤紀錄(綁定 補打卡申請):
 *   表單模組;頁內權限 `edit-day-offs` / `edit-calendar` 等的動作段以 `edit-` 開頭,
 *   `formModuleDeclaration` 為了不與表單動態權限(欄位級 `edit-<formKey>-<fieldKey>`)混淆一律拒收,
 *   所以這幾筆在骨架外另外加上(落庫為 seed 權限,不是 `source: dynamic`,表單發布的清理碰不到)。
 */
export const SCHEDULE_GROUP_KEY = "schedule";
export const SCHEDULE_MY_KEY = "schedule.my";
export const SCHEDULE_MANAGE_KEY = "schedule.manage";
export const SCHEDULE_SETTINGS_KEY = "schedule.settings";
export const SCHEDULE_ATTENDANCE_KEY = "schedule.attendance";

interface PermissionSpec {
  action: string;
  name: string;
  description: string;
}

function permissionsOf(
  moduleKey: string,
  specs: readonly PermissionSpec[],
): PermissionDeclaration[] {
  return specs.map((spec) => ({
    key: permissionKey(moduleKey, spec.action),
    moduleKey,
    name: spec.name,
    description: spec.description,
  }));
}

/** 表單模組骨架 + 骨架不收的頁內權限。 */
function withExtraPermissions(
  declaration: ModuleSeedDeclaration,
  moduleKey: string,
  specs: readonly PermissionSpec[],
): ModuleSeedDeclaration {
  return {
    ...declaration,
    permissions: [
      ...(declaration.permissions ?? []),
      ...permissionsOf(moduleKey, specs),
    ],
  };
}

export const scheduleGroupModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: SCHEDULE_GROUP_KEY,
      name: "班表管理",
      sidebarType: "group",
      parentKey: null,
      order: 80,
      route: "schedule",
      icon: "calendar",
      description: "排班與出勤:我的班表、排班作業、排班設定、出勤紀錄",
    },
  ],
};

export const scheduleMyModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: SCHEDULE_MY_KEY,
      name: "我的班表",
      sidebarType: "link",
      parentKey: SCHEDULE_GROUP_KEY,
      order: 1,
      route: "my",
      icon: "person",
      description: "自己的班表(跨分店、只顯示已發布的班)、打卡、我的畫休",
    },
  ],
  permissions: permissionsOf(SCHEDULE_MY_KEY, [
    { action: "view", name: "檢視", description: "看自己的班表" },
    {
      action: "punch",
      name: "打卡",
      description: "在排班卡片上打上班 / 下班卡",
    },
    {
      action: "edit-day-offs",
      name: "畫休",
      description: "畫休開放期間內登記自己下個月的畫休",
    },
  ]),
};

export const scheduleManageModule: ModuleSeedDeclaration = withExtraPermissions(
  formModuleDeclaration({
    key: SCHEDULE_MANAGE_KEY,
    name: "排班作業",
    parentKey: SCHEDULE_GROUP_KEY,
    route: "manage",
    order: 2,
    icon: "calendar",
    description:
      "排班表、畫休總覽、行事曆、支援需求單(表單模組,綁定 支援需求單);自動排班、發布",
    permissions: [
      {
        action: "auto-run",
        name: "自動排班",
        description: "未發布的月份執行自動排班(含以預設週範本補上人力需求)",
      },
      { action: "publish", name: "發布", description: "發布一個月份的班表" },
      {
        action: "view-day-offs",
        name: "畫休總覽",
        description: "看畫休總覽分頁",
      },
      {
        action: "use-punch-time",
        name: "上下班時間改用打卡時間",
        description: "排班對話框勾「上下班時間改用打卡時間」",
      },
    ],
  }),
  SCHEDULE_MANAGE_KEY,
  [
    {
      action: "edit-day-offs",
      name: "代改畫休",
      description: "在畫休總覽替員工代改畫休(截止後必填原因)",
    },
    {
      action: "edit-calendar",
      name: "編輯行事曆",
      description: "行事曆的 [新增] 店休 / 特殊日、修改與刪除",
    },
  ],
);

export const scheduleSettingsModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: SCHEDULE_SETTINGS_KEY,
      name: "排班設定",
      sidebarType: "link",
      parentKey: SCHEDULE_GROUP_KEY,
      order: 3,
      route: "settings",
      icon: "tune",
      description: "排班人員、人力需求範本、人力需求週範本、規則",
    },
  ],
  permissions: permissionsOf(SCHEDULE_SETTINGS_KEY, [
    { action: "view", name: "檢視", description: "看排班設定的四個分頁" },
    {
      action: "edit-templates",
      name: "編輯範本",
      description: "新增、修改、刪除人力需求範本與人力需求週範本",
    },
    {
      action: "edit-staff",
      name: "編輯排班人員",
      description: "[加入排班]、設定僱用類型與可以排的分店",
    },
    {
      action: "edit-default-rules",
      name: "編輯總部預設規則",
      description: "設定最上層組織的規則(各分店沿用的預設值)",
    },
    {
      action: "edit-org-rules",
      name: "編輯分店規則",
      description: "分店的規則 [自訂] / [還原]",
    },
  ]),
};

export const scheduleAttendanceModule: ModuleSeedDeclaration =
  formModuleDeclaration({
    key: SCHEDULE_ATTENDANCE_KEY,
    name: "出勤紀錄",
    parentKey: SCHEDULE_GROUP_KEY,
    route: "attendance",
    order: 4,
    icon: "list",
    description:
      "出勤紀錄(依人員 / 依分店)、補打卡申請(表單模組,綁定 補打卡申請)",
    permissions: [
      {
        action: "view-all",
        name: "看全部",
        description: "看全店 / 全部人員的出勤紀錄(沒有時只看自己的)",
      },
      { action: "export", name: "匯出", description: "匯出出勤紀錄 Excel" },
      {
        action: "reassign-punches",
        name: "改對應排班",
        description: "修改打卡對應的排班(原因必填)",
      },
    ],
  });

/** 依樹的先後:群組在前。 */
export const scheduleModuleDeclarations: readonly ModuleSeedDeclaration[] = [
  scheduleGroupModule,
  scheduleMyModule,
  scheduleManageModule,
  scheduleSettingsModule,
  scheduleAttendanceModule,
];
