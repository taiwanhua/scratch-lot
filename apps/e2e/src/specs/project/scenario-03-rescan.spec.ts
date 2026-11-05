import { errorReasonOf } from "../../fixtures/graphql";
import {
  moveByCountRaw,
  submitCountStocktake,
} from "../../fixtures/project/lottery-api";
import {
  openBoard,
  scanWithGun,
  waitForOperation,
} from "../../fixtures/project/lottery-ui";
import {
  CASH_POINT_A,
  CASH_POINT_B,
  createCountStore,
  ticketNosOf,
} from "../../fixtures/project/scenario-count-store";
import { expect, test } from "../../fixtures/test";
import { chooseOption, dialogWithButton, pageArea } from "../../fixtures/ui";

const STOCK = "庫存";

/** 正本:`docs/testing/project/scenarios.md`「scratch-lot 劇本 3」。 */
test("scratch-lot 劇本 3:全店重刷,沒刷到的待查·未對號變確定待查", async ({
  tenant,
  page,
}) => {
  const { lottery, store } = await createCountStore(tenant);
  const main = pageArea(page);

  // 前置:A 台盤點少 1 張記 [待查],系統帶入 #001;其實 #001 還在,不見的是 #002
  await submitCountStocktake(lottery.token, {
    orgId: store.orgId,
    cashPointId: store.cashPointA,
    scopeLabel: CASH_POINT_A,
    gameId: lottery.gameId,
    presentCount: 5,
    investigateCount: 1,
  });
  expect(await ticketNosOf(lottery, store, "investigating", true)).toEqual([
    "001",
  ]);

  // 1. 看板的重刷提醒 → [全店重刷 遊戲 X] → 確認要刷的位置 → 開始
  await openBoard(page, tenant.tenantAdmin, store.orgId, CASH_POINT_A);
  await expect(
    main.getByText(`遊戲 ${lottery.gameLabel} 有 1 張待查還沒確認是哪張`, {
      exact: false,
    }),
  ).toBeVisible();
  await main
    .getByRole("button", { name: `全店重刷 遊戲 ${lottery.gameCode}` })
    .click();
  const start = dialogWithButton(page, "開始全店重刷");
  await expect(start).toContainText(
    `${CASH_POINT_A}、${CASH_POINT_B}、${STOCK}(3 個)`,
  );
  await Promise.all([
    waitForOperation(page, "StartLotteryRescan"),
    start.getByRole("button", { name: "開始全店重刷" }).click(),
  ]);
  await expect(
    main.getByRole("heading", { name: `全店重刷 · ${lottery.gameLabel}` }),
  ).toBeVisible();
  const rescanUrl = page.url();

  // 2. 重刷中移櫃暫停:看板橫幅、卡片的兩顆移櫃按鈕變灰並寫原因;硬送一樣被擋
  await page.goto(`/store?org=${store.orgId}`);
  await expect(
    main.getByText(
      new RegExp(`遊戲 ${lottery.gameLabel} 全店重刷中,暫停移櫃 · 已刷 0/3`),
    ),
  ).toBeVisible();
  await main
    .getByRole("button", { name: new RegExp(`${lottery.gameCode} 發大財`) })
    .first()
    .click();
  await expect(main.getByRole("button", { name: "刷條碼移櫃" })).toBeDisabled();
  await expect(main.getByRole("button", { name: "依張數移櫃" })).toBeDisabled();
  await expect(
    main.getByText(`遊戲 ${lottery.gameLabel} 全店重刷中,暫停移櫃`, {
      exact: true,
    }),
  ).toBeVisible();
  const moved = await moveByCountRaw(lottery.token, {
    orgId: store.orgId,
    gameId: lottery.gameId,
    fromCashPointId: store.cashPointA,
    toCashPointId: store.cashPointB,
    count: 1,
  });
  expect(errorReasonOf(moved)).toBe("MOVE_PAUSED");

  // 3. A 台:條碼槍刷到系統帶入待查的 #001 → 和沒刷到的 #002 對號;其餘 #003–#006 沒問題;#002 找不到
  await page.goto(rescanUrl);
  await expect(main.getByText("現在刷:A 台")).toBeVisible();
  for (const ticketNo of ["001", "003", "004", "005", "006"]) {
    await Promise.all([
      waitForOperation(page, "ScanLotteryRescanTicket"),
      scanWithGun(page, store.codeOf(ticketNo)),
    ]);
  }
  await expect(main.getByText("這裡已刷 5 張")).toBeVisible();
  await expect(main.getByText("已對號", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "這裡刷完了" }).click();
  const finish = dialogWithButton(page, "刷完了");
  await expect(finish).toContainText("A 台刷到 5 張,確定刷完了?");
  await Promise.all([
    waitForOperation(page, "FinishLotteryRescanPlace"),
    finish.getByRole("button", { name: "刷完了" }).click(),
  ]);
  expect(await ticketNosOf(lottery, store, "investigating", true)).toEqual([
    "002",
  ]);

  // 4. B 台:手輸 #007–#009,#010 沒刷到 → 按刷完當下記待查
  await chooseOption(page, "現在刷哪個位置", CASH_POINT_B);
  const input = main.getByLabel("刷條碼、相機或手輸張號");
  for (const ticketNo of ["007", "008", "009"]) {
    await input.fill(store.codeOf(ticketNo));
    await Promise.all([
      waitForOperation(page, "ScanLotteryRescanTicket"),
      input.press("Enter"),
    ]);
  }
  await expect(main.getByText("這裡已刷 3 張")).toBeVisible();
  await main.getByRole("button", { name: "這裡刷完了" }).click();
  await Promise.all([
    waitForOperation(page, "FinishLotteryRescanPlace"),
    finish.getByRole("button", { name: "刷完了" }).click(),
  ]);

  // 5. 庫存沒有這個遊戲的張:直接刷完 → 全部位置刷完,結果摘要
  await chooseOption(page, "現在刷哪個位置", STOCK);
  await main.getByRole("button", { name: "這裡刷完了" }).click();
  await Promise.all([
    waitForOperation(page, "FinishLotteryRescanPlace"),
    finish.getByRole("button", { name: "刷完了" }).click(),
  ]);
  await expect(main.getByText(/全店重刷完成 · 3\/3 個位置/)).toBeVisible();
  await expect(main.getByText("結果摘要")).toBeVisible();

  // 6. 待查·未對號變確定待查:張號確定,待查·遺失分頁不再標「系統預設帶入」
  expect(await ticketNosOf(lottery, store, "investigating", true)).toEqual([]);
  expect(await ticketNosOf(lottery, store, "investigating", false)).toEqual([
    "002",
    "010",
  ]);
  await page.goto("/inventory?tab=investigations");
  const investigations = page.getByRole("table", { name: "待查·遺失" });
  await expect(investigations).toContainText(lottery.gameLabel);
  await expect(investigations).toContainText("002");
  await expect(investigations).toContainText("010");
  await expect(investigations).not.toContainText("系統預設帶入");

  // 7. 回看板:提醒與橫幅都消失,移櫃恢復
  await page.goto(`/store?org=${store.orgId}`);
  await main
    .getByRole("button", { name: new RegExp(`${lottery.gameCode} 發大財`) })
    .first()
    .click();
  await expect(main.getByRole("button", { name: "依張數移櫃" })).toBeEnabled();
  await expect(main.getByText(/全店重刷中/)).toHaveCount(0);
  await expect(main.getByText(/待查還沒確認/)).toHaveCount(0);
});
