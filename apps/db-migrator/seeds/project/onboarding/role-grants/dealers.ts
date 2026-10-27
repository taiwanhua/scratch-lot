import {
  DEALERS_CONTACTS_KEY,
  DEALERS_KEY,
  DEALERS_MODULE_KEYS,
} from "../../dealers";
import { type ModuleRoleGrants, everything } from "../roles";

const ALL_MODULES = Object.values(DEALERS_MODULE_KEYS);

/**
 * 經銷商管理(規格 3.3;權限表正本 `docs/modules/project/dealers.md`):
 *
 * - 總部管理:全部(兩層 `*`)。
 * - 店長:看得到甲類 / 乙類 / 關係人與詳情(證照到期、牌租提醒的收件人),**不含主檔修改**,
 *   也不含兩個批購基準日的欄位級權限。
 * - 店員:不給。
 */
export const dealersGrants: ModuleRoleGrants = {
  section: "經銷商管理",
  grants: {
    hq: {
      moduleKeys: ALL_MODULES,
      permissionKeys: [
        everything(DEALERS_KEY),
        everything(DEALERS_CONTACTS_KEY),
      ],
    },
    "store-manager": {
      moduleKeys: [
        DEALERS_MODULE_KEYS.list,
        DEALERS_MODULE_KEYS.viewPage,
        DEALERS_MODULE_KEYS.contacts,
        DEALERS_MODULE_KEYS.contactViewPage,
      ],
      permissionKeys: [],
    },
  },
};
