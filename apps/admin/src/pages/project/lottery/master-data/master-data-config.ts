/**
 * 檔案管理(`master-data`)前端的常數(權限表正本 `docs/modules/project/master-data.md`)。
 * 模組 key 與權限 key 與 api / seed 同一份(`@repo/domain/project/lottery-master-data`)。
 */
export {
  MASTER_DATA_MODULE_KEYS,
  MASTER_DATA_PERMISSIONS,
} from "@repo/domain/project/lottery-master-data";

/** i18n namespace(`packages/i18n/messages/<語系>/project/admin.json`)。 */
export const MASTER_DATA_I18N = "admin.lotteryMasterData";

/** 列表每頁筆數。 */
export const MASTER_DATA_PAGE_SIZE = 20;

/** 遊戲列表的最小寬度(STYLE-11:九欄不折行)。 */
export const GAMES_TABLE_MIN_WIDTH = 960;

/** 收銀點列表的最小寬度。 */
export const CASH_POINTS_TABLE_MIN_WIDTH = 760;

/** 頁內分頁的值(`?tab=`)。 */
export const MASTER_DATA_TABS = {
  games: "games",
  cashPoints: "cash-points",
} as const;

/** 收銀點的印表機選單要的權限(底座 `printablePrinters`)。 */
export const PRINT_PERMISSION = "api.printing.print";
