import { describe, expect, it } from "@jest/globals";

import { projectSeedSource } from "./registry";

/**
 * 張數帳本的四張表**不能是資料範圍目標**(ADR-0008):帳本、本的即時計算、預計要給本數與遊戲引用檢查
 * 會以租戶邊界上下文讀寫這幾張表,那個上下文沒有角色,對全員生效的規則照樣收窄 —— 帳本會被規則
 * 擋成假的「已被處理」、已給本數會算少(`apps/api/src/database/tenant-boundary-context.ts` 的前提)。
 * 要開放資料範圍,先把這些讀寫改回不經租戶邊界上下文,再拿掉這個測試。
 */
const LEDGER_COLLECTIONS = new Set([
  "lottery_books",
  "lottery_tickets",
  "lottery_ticket_events",
  "lottery_allocations",
]);

describe("張數帳本的表不宣告資料範圍目標", () => {
  it("專案模組宣告沒有任何一個以這四張表為資料範圍目標", () => {
    const targets = projectSeedSource.moduleDeclarations.flatMap(
      (declaration) =>
        declaration.dataScopeTarget
          ? [declaration.dataScopeTarget.collection]
          : [],
    );
    expect(
      targets.filter((collection) => LEDGER_COLLECTIONS.has(collection)),
    ).toEqual([]);
  });
});
