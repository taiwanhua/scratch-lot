import { REPORTS_MODULE_KEY } from "../../../base/modules/reports";
import { type ModuleRoleGrants, type RoleGrant, everything } from "../roles";

/** 輸出報表全部(兩張報表、匯出、成本與毛利)。 */
const ALL_REPORTS: RoleGrant = {
  moduleKeys: [REPORTS_MODULE_KEY],
  permissionKeys: [everything(REPORTS_MODULE_KEY)],
};

/**
 * 輸出報表(規格 3.3;權限表正本 `docs/modules/project/reports.md`):
 * 總部管理全部;店長「輸出報表」全部(3.3 店長的排除項目不含報表);店員不給。
 */
export const reportsGrants: ModuleRoleGrants = {
  section: "輸出報表",
  grants: { hq: ALL_REPORTS, "store-manager": ALL_REPORTS },
};
