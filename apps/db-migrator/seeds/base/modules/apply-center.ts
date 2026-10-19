import {
  type ModuleSeedDeclaration,
  permissionKey,
} from "../module-declaration";

export const APPLY_CENTER_KEY = "apply-center";

/**
 * 申請中心(固定模組):兩個跨模組的頁籤(我的申請 / 待我審核)
 * + 「新申請」入口 + 自己的隱藏詳情頁。表單都留在各自的業務模組,這裡不是表單模組。
 *
 * - 權限只有 `view`(租戶管理員模板預設含):內容以「我」為邊界(我送的、派給我的),不需要資料範圍目標
 * - 隱藏頁 `view-page` = 申請中心詳情頁的路由節點兼權限容器:沒有業務模組頁面權限的審核者從這裡看,
 *   不會被業務模組的路由擋
 */
export const applyCenterModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: APPLY_CENTER_KEY,
      name: "申請中心",
      sidebarType: "link",
      parentKey: null,
      order: 4,
      route: "apply-center",
      icon: "mail",
      description: "我的申請與待我審核(跨模組),以及新申請入口",
    },
    {
      key: `${APPLY_CENTER_KEY}.view-page`,
      name: "申請詳情",
      sidebarType: "hidden",
      parentKey: APPLY_CENTER_KEY,
      order: 1,
      route: "view-page",
    },
  ],
  permissions: [
    {
      key: permissionKey(APPLY_CENTER_KEY, "view"),
      moduleKey: APPLY_CENTER_KEY,
      name: "檢視",
      description: "進入申請中心:看自己的申請與派給自己的審核任務",
    },
  ],
};
