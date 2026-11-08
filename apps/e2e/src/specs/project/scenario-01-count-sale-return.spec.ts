import {
  cashPointHeader,
  expectSold,
  openBoard,
  scanWithGun,
  snackbar,
  waitForOperation,
} from "../../fixtures/project/lottery-ui";
import {
  CASH_POINT_A,
  UNIT_PRICE,
  createCountStore,
  ticketNosOf,
} from "../../fixtures/project/scenario-count-store";
import { expect, test } from "../../fixtures/test";
import { dialogWithButton } from "../../fixtures/ui";

/** 正本:`docs/testing/project/scenarios.md`「scratch-lot 劇本 1」。 */
test("scratch-lot 劇本 1:依張數賣、刷到實體對號、刷退的票", async ({
  tenant,
  page,
}) => {
  const { lottery, store } = await createCountStore(tenant);
  await openBoard(page, tenant.tenantAdmin, store.orgId, CASH_POINT_A);

  // 1. [依張數標記售出] 2 張 → 系統照挑張順序記 #001、#002 已售·未對號
  await cashPointHeader(page, CASH_POINT_A)
    .getByRole("button", { name: "依張數標記售出" })
    .click();
  const countSale = dialogWithButton(page, "標記售出");
  await countSale.getByRole("button", { name: "第 1 列多一張" }).click();
  await Promise.all([
    waitForOperation(page, "SellLotteryTicketsByCount"),
    countSale.getByRole("button", { name: "標記售出" }).click(),
  ]);
  await expect(
    snackbar(page, `${lottery.gameLabel} × 2 張,合計 400`),
  ).toBeVisible();
  await expectSold(page, CASH_POINT_A, 2, 2 * UNIT_PRICE);
  expect(await ticketNosOf(lottery, store, "sold", true)).toEqual([
    "001",
    "002",
  ]);

  // 2. 看板刷條碼賣到系統帶入的那張 #001 → 和 A 台第一張未售的 #003 對號:#001 確定賣出、#003 接手已售·未對號
  await Promise.all([
    waitForOperation(page, "SellLotteryTickets"),
    scanWithGun(page, store.codeOf("001")),
  ]);
  await expect(snackbar(page, /A 台 · 已對號/)).toBeVisible();
  await expectSold(page, CASH_POINT_A, 3, 3 * UNIT_PRICE);
  expect(await ticketNosOf(lottery, store, "sold", false)).toEqual(["001"]);
  expect(await ticketNosOf(lottery, store, "sold", true)).toEqual([
    "002",
    "003",
  ]);

  // 3. 看板刷未售的票 #004 = 賣出
  await Promise.all([
    waitForOperation(page, "SellLotteryTickets"),
    scanWithGun(page, store.codeOf("004")),
  ]);
  await expectSold(page, CASH_POINT_A, 4, 4 * UNIT_PRICE);
  expect(await ticketNosOf(lottery, store, "sold", false)).toEqual([
    "001",
    "004",
  ]);

  // 4. [最近售出] 開著時,刷未售的票 #005 = 退票:撤銷確認 → 和最近一筆依張數售出對號後撤掉
  await cashPointHeader(page, CASH_POINT_A)
    .getByRole("button", { name: "最近售出" })
    .click();
  const returnField = page.getByLabel("刷退的票");
  await expect(returnField).toBeVisible();
  await scanWithGun(page, store.codeOf("005"));
  const undo = dialogWithButton(page, "撤銷");
  await expect(undo).toContainText("#005");
  // 還沒按撤銷:#005 沒有被賣出
  expect(await ticketNosOf(lottery, store, "sold")).not.toContain("005");
  await Promise.all([
    waitForOperation(page, "UndoLotteryTicketSale"),
    undo.getByRole("button", { name: "撤銷" }).click(),
  ]);
  await expect(
    snackbar(page, /已撤銷。已對號:這張接手了 .+ 依張數售出的 1 張/),
  ).toBeVisible();
  await expectSold(page, CASH_POINT_A, 3, 3 * UNIT_PRICE);
  expect(await ticketNosOf(lottery, store, "sold", true)).toHaveLength(1);
  expect(await ticketNosOf(lottery, store, "sold")).not.toContain("005");

  // 5. 手輸刷條碼賣出的 #004:照張號撤,不對號
  await returnField.fill(store.codeOf("004"));
  await returnField.press("Enter");
  await expect(undo).toContainText("#004");
  await Promise.all([
    waitForOperation(page, "UndoLotteryTicketSale"),
    undo.getByRole("button", { name: "撤銷" }).click(),
  ]);
  await expectSold(page, CASH_POINT_A, 2, 2 * UNIT_PRICE);
  expect(await ticketNosOf(lottery, store, "sold", false)).toEqual(["001"]);
  expect(await ticketNosOf(lottery, store, "sold", true)).toHaveLength(1);
});
