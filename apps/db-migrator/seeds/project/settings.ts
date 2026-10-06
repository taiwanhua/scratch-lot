import type { ProjectSeedSettings } from "../base/seed-source";

/**
 * 專案的種子初值(正本:ADR-0002)。這些是**初始值**:建立時寫入,之後保留人在後台的修改,
 * 完整清庫還原才重建為這裡的值。
 *
 * - `rootOrg`:根組織的顯示名稱、說明與 settings(名稱是品牌文字,改動要同步 docs/branding.md)
 * - `moduleInitialValues`:既有模組的初值指定,以模組 key 為鍵,只收 `enabled`、`icon`、`settings`
 */
export const projectSeedSettings: ProjectSeedSettings = {
  rootOrg: {
    name: "scratch-lot",
    description: "平台營運者(根組織)",
    settings: {},
  },
  moduleInitialValues: {},
};
