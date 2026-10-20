import {
  ACCOUNTS_KEY,
  ACCOUNTS_MODULE_KEYS as KEYS,
  ACCOUNTS_PERMISSIONS as PERMISSIONS,
} from "@repo/domain/project/lottery-accounts";

import type { ModuleSeedDeclaration } from "../base/module-declaration";

/**
 * 帳戶管理(專案規格 3.1、3.2、第 9 章、第 10 章;正本 `docs/modules/project/accounts.md`):
 * 一頁四個分頁(銀行帳戶 | 即時現金帳 | 待結清款項 | 關帳),分頁由 `view-*` / `close-period`
 * 權限決定出不出現(不是模組節點);銀行帳戶詳情是隱藏頁。一次宣告整個模組的全部權限
 * (含關帳的 `close-period`,關帳分頁由關帳功能追加),之後同模組的票不改這份宣告。
 * 本模組沒有 `view` 權限(規格 3.2):進不進得去看模組本身。不宣告資料範圍目標。
 */
export const accountsModule: ModuleSeedDeclaration = {
  nodes: [
    {
      key: ACCOUNTS_KEY,
      name: "帳戶管理",
      sidebarType: "link",
      parentKey: null,
      order: 40,
      route: "accounts",
      icon: "business",
      description: "銀行帳戶、即時現金帳、待結清款項與關帳",
    },
    {
      key: KEYS.bankAccountViewPage,
      name: "銀行帳戶詳情",
      sidebarType: "hidden",
      parentKey: ACCOUNTS_KEY,
      order: 1,
      route: "view-page",
    },
  ],
  permissions: [
    {
      key: PERMISSIONS.viewBankAccounts,
      moduleKey: ACCOUNTS_KEY,
      name: "銀行帳戶分頁",
      description: "看得到銀行帳戶分頁與帳戶詳情",
    },
    {
      key: PERMISSIONS.createBankAccount,
      moduleKey: ACCOUNTS_KEY,
      name: "新增帳戶",
      description: "[+ 新增帳戶] + 新增 API",
    },
    {
      key: PERMISSIONS.editBankAccount,
      moduleKey: ACCOUNTS_KEY,
      name: "編輯帳戶",
      description: "帳戶設定、使用組織、停用;沒有交易時刪除",
    },
    {
      key: PERMISSIONS.recordBankTransaction,
      moduleKey: ACCOUNTS_KEY,
      name: "登記交易",
      description: "帳戶詳情的 [登記交易]",
    },
    {
      key: PERMISSIONS.reverseBankTransaction,
      moduleKey: ACCOUNTS_KEY,
      name: "沖正",
      description: "帳戶詳情的 [沖正]",
    },
    {
      key: PERMISSIONS.viewCash,
      moduleKey: ACCOUNTS_KEY,
      name: "即時現金帳分頁",
      description: "看得到即時現金帳分頁(只能查看)",
    },
    {
      key: PERMISSIONS.viewOutstanding,
      moduleKey: ACCOUNTS_KEY,
      name: "待結清款項分頁",
      description: "看得到待結清款項分頁與側欄數字;每列按鈕沿用單據的收付權限",
    },
    {
      key: PERMISSIONS.closePeriod,
      moduleKey: ACCOUNTS_KEY,
      name: "關帳",
      description: "關帳分頁與 [關帳]",
    },
  ],
};
