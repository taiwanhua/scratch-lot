import { API_PRINTING_KEY } from "../../base/modules/api";
import type { ModuleRoleGrants, RoleGrant } from "../onboarding/roles";

const PRINT = `${API_PRINTING_KEY}.print`;
const REPRINT = `${API_PRINTING_KEY}.reprint`;

/** 列印 + 補印。 */
const PRINT_AND_REPRINT: RoleGrant = {
  moduleKeys: [API_PRINTING_KEY],
  permissionKeys: [PRINT, REPRINT],
};

/**
 * **示範資料專用**的角色配方一段:列印權限(`docs/modules/printers.md`)。開通清單第 9 點「有收據機才做」,
 * 真實租戶由租戶管理員自己在角色管理勾(開通腳本不給);示範機構要能直接驗收收據,所以示範指令的「角色」那一步
 * 多套這一段:總部管理、店長 列印 + 補印;店員只有列印(補印留給店長以上)。
 * 和開通配方一樣只套在新建的角色上(已有權限的角色不覆蓋)。
 */
export const demoPrintingGrants: ModuleRoleGrants = {
  section: "列印(示範)",
  grants: {
    hq: PRINT_AND_REPRINT,
    "store-manager": PRINT_AND_REPRINT,
    clerk: { moduleKeys: [API_PRINTING_KEY], permissionKeys: [PRINT] },
  },
};
