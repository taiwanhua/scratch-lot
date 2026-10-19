import { APPLY_CENTER_KEY } from "../../../base/modules/apply-center";
import { OVERVIEW_MODULE_KEY } from "../../../base/modules/overview";
import { type ModuleRoleGrants, type RoleGrant, everything } from "../roles";

const APPLY_CENTER_PAGE = `${APPLY_CENTER_KEY}.view-page`;

/** 總覽與申請中心:三個角色都要(送單、審核都從申請中心進;總覽是登入後的第一頁)。 */
const EVERYONE: RoleGrant = {
  moduleKeys: [OVERVIEW_MODULE_KEY, APPLY_CENTER_KEY, APPLY_CENTER_PAGE],
  permissionKeys: [
    everything(OVERVIEW_MODULE_KEY),
    everything(APPLY_CENTER_KEY),
    everything(APPLY_CENTER_PAGE),
  ],
};

/**
 * 底座的共用入口模組。系統管理(組織、使用者、角色、欄位、通知設定…)留給租戶管理員,
 * 開通時建立的三個角色都不給。
 */
export const baseModuleGrants: ModuleRoleGrants = {
  section: "總覽、申請中心",
  grants: { hq: EVERYONE, "store-manager": EVERYONE, clerk: EVERYONE },
};
