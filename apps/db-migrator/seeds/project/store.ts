import { STORE_KEY } from "@repo/domain/project/lottery";

import { formModuleDeclaration } from "../base/form-module-declaration";
import type { ModuleSeedDeclaration } from "../base/module-declaration";

/**
 * 店面管理(規格 3.1、3.2、第 6 章;正本 `docs/modules/project/store.md`)。本檔一次宣告全部權限
 * (後續店面的票不改):表單模組(之後綁定 撤銷售出申請、現金更正單、盤點確認申請、結帳確認申請),
 * **開啟 B9b**(`perFormCreate`:每張表單發布時自動建 `store.create-<formKey>`)、表單四條 + 規格 3.2 的頁內權限。
 * 側欄順序 10(專案模組依規格 3.1 ×10)。
 */
export const storeModule: ModuleSeedDeclaration = formModuleDeclaration({
  key: STORE_KEY,
  name: "店面管理",
  parentKey: null,
  route: "store",
  order: 10,
  icon: "store",
  description:
    "看板(收銀點、開班、投庫 / 出庫、銷售、兌獎)、盤點、交班結帳與日結(表單模組,依表單分開新增權限)",
  perFormCreate: true,
  permissions: [
    {
      action: "sell",
      name: "銷售",
      description: "刷條碼售出、[標記售出] [補登售出]",
    },
    {
      action: "undo-sale",
      name: "當下撤銷",
      description: "售出提示的 [撤銷]、[撤銷售出](30 分鐘內、班還開著)",
    },
    { action: "split", name: "拆本", description: "收銀點標題列的 [拆本]" },
    {
      action: "move",
      name: "移櫃",
      description: "展開卡片的 [移櫃] [收回] [移櫃並售出]",
    },
    {
      action: "redeem",
      name: "兌獎",
      description: "[兌獎] [補登兌獎];自己登記、班還開著的當下撤銷兌獎",
    },
    {
      action: "undo-redeem",
      name: "撤銷兌獎",
      description: "撤銷已結帳的班或別人登記的兌獎",
    },
    {
      action: "open-shift",
      name: "開班",
      description: "收銀點標題列的 [開班]",
    },
    { action: "deposit", name: "投庫", description: "抽屜 → 小金庫" },
    {
      action: "withdraw",
      name: "出庫",
      description: "小金庫 → 抽屜;開班時「從小金庫領零用金」",
    },
    { action: "bank-deposit", name: "存銀行", description: "頂部的 [存銀行]" },
    { action: "stocktake", name: "盤點", description: "頂部的 [盤點]" },
    {
      action: "checkout",
      name: "結帳與日結",
      description: "[交班結帳] [日結]",
    },
    {
      action: "skip-stocktake",
      name: "跳過盤點",
      description: "交班結帳、日結的盤點步驟可以「跳過盤點」",
    },
    {
      action: "confirm-lost",
      name: "確認遺失",
      description: "盤點待查清單的 [確認遺失]",
    },
  ],
});
