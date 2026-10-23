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

/** 叫貨單(`requisition`)的一個表單欄位欄。 */
function requisitionColumn(key: string, width: number, order: number) {
  return { kind: "field", key, formKey: "requisition", width, order };
}

/** 調貨單(`transfer`)的一個表單欄位欄。 */
function transferColumn(key: string, width: number, order: number) {
  return { kind: "field", key, formKey: "transfer", width, order };
}

/** 進貨單(`purchase`)的一個表單欄位欄。 */
function purchaseColumn(key: string, width: number, order: number) {
  return { kind: "field", key, formKey: "purchase", width, order };
}

export const projectSeedSettings: ProjectSeedSettings = {
  rootOrg: {
    name: "scratch-lot",
    description: "平台營運者(根組織)",
    settings: {},
  },
  moduleInitialValues: {
    // 排班作業 → 支援需求單的列表欄位配置(規格 14.10;Figma SC-31):單號、開始、結束(日期時間)、崗位、需要人數、分店
    // + 內建欄「狀態」。初始 seed 值:模組的 settings 已存在就不覆寫,之後由平台管理員在「模組與權限」調整。
    // 注意:這裡的 settings 會整份取代 P06 在 `schedule.ts` 宣告裡的 `settings`(初值不逐鍵合併)
    "schedule.manage": {
      settings: {
        list: {
          columns: [
            // 單號(摘要槽 `serialNo`;受管表單宣告的單號格式 SP-0001)
            { kind: "slot", key: "serialNo", width: 100, order: 0 },
            supportRequestColumn("start_at", 150, 1),
            supportRequestColumn("end_at", 150, 2),
            supportRequestColumn("position", 140, 3),
            supportRequestColumn("headcount", 100, 4),
            supportRequestColumn("branch", 140, 5),
          ],
          builtin: { form: false, status: true, createdBy: false },
        },
      },
    },
    // 叫貨、採購單 → 叫貨單的列表欄位配置(規格 8.1;Figma PU-01):單號、叫貨分店、期望到貨日、本數
    // + 內建欄「狀態」(畫面再細分 待購買 / 已進貨 / 已調貨)、「建立者」。初始 seed 值,之後由平台管理員調整
    "purchasing.requisition": {
      settings: {
        list: {
          columns: [
            // 單號(摘要槽 `serialNo`;受管表單宣告的單號格式 R-0001)
            { kind: "slot", key: "serialNo", width: 110, order: 0 },
            requisitionColumn("branch", 140, 1),
            requisitionColumn("expected_date", 130, 2),
            requisitionColumn("total_books", 90, 3),
          ],
          builtin: { form: false, status: true, createdBy: true },
        },
      },
    },
    // 叫貨與進貨 → 進貨單的列表欄位配置(規格 8.2;Figma PU-04):單號、進貨分店、甲類、批購日、扣款金額
    // + 內建欄「狀態」;點收進度與結算由列表頁另外接(`lotteryPurchaseProgress`)。初始 seed 值,之後由平台管理員調整
    "purchasing.purchase": {
      settings: {
        list: {
          columns: [
            // 單號(摘要槽 `serialNo`;受管表單宣告的單號格式 P-0001)
            { kind: "slot", key: "serialNo", width: 110, order: 0 },
            purchaseColumn("branch", 120, 1),
            purchaseColumn("dealer", 160, 2),
            purchaseColumn("purchase_date", 110, 3),
            purchaseColumn("deducted_amount", 110, 4),
          ],
          builtin: { form: false, status: true, createdBy: false },
        },
      },
    },
    // 叫貨與進貨 → 調貨單的列表欄位配置(規格 8.4;Figma PU-08):單號、出貨店、收貨店、調貨金額 + 內建欄「狀態」;
    // 本數 / 張數、點收進度、結算由列表頁另外接(`lotteryTransferProgress`)。初始 seed 值,之後由平台管理員調整
    "purchasing.transfer": {
      settings: {
        list: {
          columns: [
            // 單號(摘要槽 `serialNo`;受管表單宣告的單號格式 T-0001)
            { kind: "slot", key: "serialNo", width: 110, order: 0 },
            transferColumn("from_branch", 120, 1),
            transferColumn("to_branch", 120, 2),
            transferColumn("transfer_total", 110, 3),
          ],
          builtin: { form: false, status: true, createdBy: false },
        },
      },
    },
  },
};
