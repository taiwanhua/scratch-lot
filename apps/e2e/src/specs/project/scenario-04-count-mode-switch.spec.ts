import { createChildOrg, setUserOrgs } from "../../fixtures/api";
import {
  customizeSetting,
  openShift,
} from "../../fixtures/project/lottery-api";
import {
  cashPointHeader,
  expectSold,
  openBoard,
  waitForOperation,
} from "../../fixtures/project/lottery-ui";
import {
  CASH_POINT_A,
  UNIT_PRICE,
  createLotteryTenant,
  stockStore,
} from "../../fixtures/project/scenario-count-store";
import { expect, test } from "../../fixtures/test";
import { dialogWithButton, pageArea } from "../../fixtures/ui";

const NEW_STORE = "新開分店";
const CONVERTING = "張數盤點 → 編號盤點(轉換中,等補點編號)";

/** 正本:`docs/testing/project/scenarios.md`「scratch-lot 劇本 4」。 */
test("scratch-lot 劇本 4:新開分店跟著上層預設成為張數店,改回編號進轉換中、取消轉換", async ({
  tenant,
  page,
}) => {
  const main = pageArea(page);
  const token = tenant.tenantAdmin.token;

  // 前置:租戶預設改成張數盤點之後才開分店,這家店沒有盤點制度那一筆
  await customizeSetting(token, {
    orgId: tenant.tenantOrgId,
    key: "count_mode",
    option: "count",
  });
  const orgId = await createChildOrg(token, tenant.tenantOrgId, NEW_STORE);
  await setUserOrgs(token, tenant.tenantAdmin.userId, [
    tenant.tenantOrgId,
    tenant.nangangOrgId,
    orgId,
  ]);
  const lottery = await createLotteryTenant(tenant, [orgId]);
  const store = await stockStore(lottery, orgId);
  await openShift(token, store.cashPointA);

  // 1. 看板就是張數店:[依張數標記售出] 賣 1 張(之後才有未對號的張)
  await openBoard(page, tenant.tenantAdmin, orgId, CASH_POINT_A);
  const header = cashPointHeader(page, CASH_POINT_A);
  await header.getByRole("button", { name: "依張數標記售出" }).click();
  const countSale = dialogWithButton(page, "標記售出");
  await Promise.all([
    waitForOperation(page, "SellLotteryTicketsByCount"),
    countSale.getByRole("button", { name: "標記售出" }).click(),
  ]);
  await expectSold(page, CASH_POINT_A, 1, UNIT_PRICE);

  // 2. 刮刮樂設定:這家店沿用上層的張數盤點
  await page.goto(`/lottery-settings?org=${orgId}`);
  const row = main.locator('[data-setting-key="count_mode"]');
  await expect(row).toContainText("張數盤點");
  await expect(row).toContainText("沿用");

  // 3. [自訂] 改回編號盤點:還有未對號的張 → 寫出會進入轉換中,存檔後值變成轉換中
  await row.getByRole("button", { name: "自訂" }).click();
  const dialog = dialogWithButton(page, "儲存");
  await dialog.getByRole("radio", { name: "編號盤點" }).check();
  await expect(dialog).toContainText(`${NEW_STORE}會進入轉換中`);
  await Promise.all([
    waitForOperation(page, "CustomizeLotterySetting"),
    dialog.getByRole("button", { name: "儲存" }).click(),
  ]);
  await expect(row).toContainText(CONVERTING);

  // 4. 看板:頂部一直提示轉換中,[依張數標記售出] 不顯示
  await page.goto(`/store?org=${orgId}`);
  await expect(main.getByText(/轉換中:請完成補點編號/)).toBeVisible();
  await expect(main.getByRole("button", { name: "補點編號" })).toBeVisible();
  await expect(header.getByRole("button", { name: "最近售出" })).toBeVisible();
  await expect(
    header.getByRole("button", { name: "依張數標記售出" }),
  ).toHaveCount(0);

  // 5. [取消轉換]:當下回到張數盤點,等於幫這家店自訂一筆張數
  await page.goto(`/lottery-settings?org=${orgId}`);
  await row.getByRole("button", { name: "取消轉換" }).click();
  await Promise.all([
    waitForOperation(page, "CancelLotteryCountModeConversion"),
    dialogWithButton(page, "取消轉換")
      .getByRole("button", { name: "取消轉換" })
      .click(),
  ]);
  await expect(row).not.toContainText("轉換中");
  await expect(row).toContainText("張數盤點");
  await expect(row).toContainText("本店自訂");

  // 6. 看板回到張數店
  await page.goto(`/store?org=${orgId}`);
  await expect(
    header.getByRole("button", { name: "依張數標記售出" }),
  ).toBeVisible();
  await expect(main.getByText(/轉換中:請完成補點編號/)).toHaveCount(0);
});
