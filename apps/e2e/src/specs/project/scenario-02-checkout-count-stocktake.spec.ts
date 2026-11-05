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
import { clickAndWaitFor, pageArea } from "../../fixtures/ui";

/** 正本:`docs/testing/project/scenarios.md`「scratch-lot 劇本 2」。 */
test("scratch-lot 劇本 2:交班張數盤點,少的張算售出、應有現金含這些張", async ({
  tenant,
  page,
}) => {
  const { lottery, store } = await createCountStore(tenant);
  await openBoard(page, tenant.tenantAdmin, store.orgId, CASH_POINT_A);

  // 前置:這一班刷條碼賣了 #001(A 台還剩 5 張)
  await Promise.all([
    waitForOperation(page, "SellLotteryTickets"),
    scanWithGun(page, store.codeOf("001")),
  ]);
  await expectSold(page, CASH_POINT_A, 1, UNIT_PRICE);

  // 1. [交班結帳] → ① 盤點:張數店沒有「跳過盤點」(+tenant 有 store.skip-stocktake 也一樣)
  await cashPointHeader(page, CASH_POINT_A)
    .getByRole("button", { name: "交班結帳" })
    .click();
  const main = pageArea(page);
  await expect(main.getByRole("radio", { name: "現在盤點" })).toBeChecked();
  await expect(main.getByRole("radio", { name: "跳過盤點" })).toHaveCount(0);

  // 2. 這一組實際剩 3 張:按 [確定] 才顯示系統數字,少 2 張
  await main.getByLabel("實際剩幾張").fill("3");
  await main.getByRole("button", { name: "確定", exact: true }).click();
  await expect(main.getByText("系統 5 · 實際 3 · 少 2 張")).toBeVisible();
  await main.getByRole("button", { name: "盤完,前往差異核對" }).click();

  // 3. 差異核對 [算售出]:立即生效,系統照挑張順序記 #002、#003 已售·未對號,算這一班
  await expect(main.getByRole("button", { name: "下一步" })).toBeDisabled();
  await clickAndWaitFor(page, "算售出", "BackfillLotteryStocktakeCountSales");
  await expect(snackbar(page, "已補登售出 2 張 · 400 元")).toBeVisible();
  await expect(
    main.getByText(/算售出 2 張:算進A 台這一班,應有現金 \+400/),
  ).toBeVisible();
  expect(await ticketNosOf(lottery, store, "sold", true)).toEqual([
    "002",
    "003",
  ]);

  // 4. ② 兌獎略過;③ 抽屜:應有現金 = 刷條碼 1 張 + 算售出 2 張,全部 600
  await main.getByRole("button", { name: "下一步" }).click();
  await main.getByRole("button", { name: "下一步" }).click();
  await expect(main.getByText("銷售(3 張)")).toBeVisible();
  await main.getByLabel("張 / 枚 500").fill("1");
  await main.getByLabel("張 / 枚 100").fill("1");
  await expect(main.getByText("實點合計")).toBeVisible();

  // 5. ④ 確認 → 送出:這一班交班,A 台回到未開班
  await main.getByRole("button", { name: "下一步" }).click();
  await expect(main.getByText("現在盤點", { exact: true })).toBeVisible();
  await Promise.all([
    waitForOperation(page, "CreateAndSubmit"),
    main.getByRole("button", { name: /^送出/ }).click(),
  ]);
  await page.waitForURL((url) => url.pathname.includes("/view-page/"));
  await expect(main.getByText("結帳單", { exact: true })).toBeVisible();
  await expect(main.getByText("銷售(3 張)")).toBeVisible();
  await expect(main.getByText("+ 600")).toBeVisible();
  await page.goto(`/store?org=${store.orgId}`);
  await expect(page.getByRole("heading", { name: CASH_POINT_A })).toBeVisible();
  await expect(main.getByText("未開班").first()).toBeVisible();
  await expect(cashPointHeader(page, CASH_POINT_A)).toHaveCount(0);
});
