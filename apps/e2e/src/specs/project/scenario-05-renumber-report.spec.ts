import {
  customizeSetting,
  sellByCount,
  submitCountStocktake,
} from "../../fixtures/project/lottery-api";
import {
  openBoard,
  previewDailyOperations,
  waitForOperation,
} from "../../fixtures/project/lottery-ui";
import {
  CASH_POINT_A,
  createCountStore,
  ticketNosOf,
} from "../../fixtures/project/scenario-count-store";
import { expect, test } from "../../fixtures/test";
import { dialogWithButton, pageArea } from "../../fixtures/ui";
import { approveAs, myTasks } from "../../fixtures/workflow-api";

/** 正本:`docs/testing/project/scenarios.md`「scratch-lot 劇本 5」。 */
test("scratch-lot 劇本 5:補點編號核准變回編號店,營運報表的估算與對號", async ({
  tenant,
  page,
}) => {
  const { lottery, store } = await createCountStore(tenant, {
    stocktakeApproval: "review",
  });
  const main = pageArea(page);
  const token = lottery.token;
  const storeName = "南港店";

  // 前置:依張數賣 2 張(系統帶入 #001、#002),A 台盤點少 1 張記待查(系統帶入 #003)。
  // 實際上 #001–#003 都還在,不見的是 #004–#006
  await sellByCount(token, {
    orgId: store.orgId,
    cashPointId: store.cashPointA,
    gameId: lottery.gameId,
    count: 2,
  });
  const stocktakeId = await submitCountStocktake(token, {
    orgId: store.orgId,
    cashPointId: store.cashPointA,
    scopeLabel: CASH_POINT_A,
    gameId: lottery.gameId,
    presentCount: 3,
    investigateCount: 1,
  });
  await approveAs(token, stocktakeId);
  expect(await ticketNosOf(lottery, store, "sold", true)).toEqual([
    "001",
    "002",
  ]);
  expect(await ticketNosOf(lottery, store, "investigating", true)).toEqual([
    "003",
  ]);

  // 1. 營運報表日報(補點之前):含估算、1 銷售有「依張數標記售出」、4 庫存異動核對對得上
  await openBoard(page, tenant.tenantAdmin, store.orgId, CASH_POINT_A);
  await previewDailyOperations(page, store.orgId, storeName);
  await expect(main.getByText(/含估算/).first()).toBeVisible();
  const sales = main.getByRole("region", { name: "1 銷售", exact: true });
  await expect(
    sales.getByRole("row", { name: /依張數標記售出/ }),
  ).toContainText("2");
  const inventory = main.getByRole("region", {
    name: "4 庫存異動",
    exact: true,
  });
  await expect(
    inventory.getByRole("row", { name: /對號成本調整/ }),
  ).toBeVisible();
  await expect(inventory.getByRole("row", { name: /核對/ })).toContainText(
    "對得上",
  );

  // 2. 改回編號盤點 → 還有未對號的張,進入轉換中(設定頁的畫面在劇本 4)
  await customizeSetting(token, {
    orgId: store.orgId,
    key: "count_mode",
    option: "numbered",
  });

  // 3. 看板 [補點編號] → 補點編號的盤點頁:照編號逐本點格子,實際在的是 #001–#003、#007–#010
  await page.goto(`/store?org=${store.orgId}`);
  await main.getByRole("button", { name: "補點編號" }).click();
  await expect(
    main.getByRole("heading", { name: "補點編號 · 全店" }),
  ).toBeVisible();
  await expect(main.getByText("虛線 = 系統預設帶入的張號")).toBeVisible();
  const books = main.locator("p", { hasText: lottery.gameLabel });
  await books.first().click();
  for (const no of ["001", "002", "003"]) {
    await main.getByRole("button", { name: new RegExp(`^#${no} `) }).click();
  }
  await books.nth(1).click();
  for (const no of ["007", "008", "009", "010"]) {
    await main.getByRole("button", { name: `#${no} 未售` }).click();
  }
  await main.getByRole("button", { name: "差異核對 →" }).click();

  // 4. 自動對號 3 張(#001–#003 ↔ #004–#006),不算差異 → 送出
  await expect(main.getByText("自動對號 3 張(不算差異)")).toBeVisible();
  await main.getByRole("button", { name: "送出 →" }).click();
  await Promise.all([
    waitForOperation(page, "CreateAndSubmit"),
    dialogWithButton(page, "送出盤點確認申請")
      .getByRole("button", { name: "送出盤點確認申請" })
      .click(),
  ]);

  // 5. 核准(店長審核;劇本不驗審核畫面)
  const tasks = await myTasks(token);
  const pending = tasks.filter((task) => task.stepName === "店長審核");
  expect(pending).toHaveLength(1);
  await approveAs(token, pending[0]?.submissionId ?? "");

  // 6. 變回編號店:未對號清掉;看板沒有遊戲合計與「約」
  expect(await ticketNosOf(lottery, store, "sold", true)).toEqual([]);
  expect(await ticketNosOf(lottery, store, "investigating", true)).toEqual([]);
  expect(await ticketNosOf(lottery, store, "sold")).toEqual(["004", "005"]);
  expect(await ticketNosOf(lottery, store, "investigating")).toEqual(["006"]);
  await page.goto(`/store?org=${store.orgId}`);
  await expect(main.getByText(/剩 \d+ \/ \d+/).first()).toBeVisible();
  await expect(main.getByText(/剩 \d+ 張 · \d+ 本/)).toHaveCount(0);
  await expect(main.getByText("約", { exact: true })).toHaveCount(0);
  await expect(main.getByText(/轉換中/)).toHaveCount(0);

  // 7. 刮刮樂設定 [變更紀錄]:轉換中 → 編號(補點編號核准)
  await page.goto(`/lottery-settings?org=${store.orgId}`);
  const row = main.locator('[data-setting-key="count_mode"]');
  await expect(row).toContainText("編號盤點");
  await row.getByRole("button", { name: "變更紀錄" }).click();
  await expect(
    dialogWithButton(page, "關閉").getByText("轉換中 → 編號(補點編號核准)"),
  ).toBeVisible();

  // 8. 營運報表日報(補點之後):核准晚於最後一筆未對號事件 → 不再含估算;對號成本調整列、核對對得上
  await previewDailyOperations(page, store.orgId, storeName);
  await expect(inventory.getByRole("row", { name: /核對/ })).toContainText(
    "對得上",
  );
  await expect(
    inventory.getByRole("row", { name: /對號成本調整/ }),
  ).toBeVisible();
  await expect(main.getByText(/含估算/)).toHaveCount(0);
});
