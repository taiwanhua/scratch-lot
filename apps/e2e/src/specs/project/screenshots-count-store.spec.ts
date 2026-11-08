import path from "node:path";

import type { Page } from "@playwright/test";

import { GREP, TMP_DIR } from "../../config";
import {
  sellByCount,
  submitCountStocktake,
} from "../../fixtures/project/lottery-api";
import {
  cashPointHeader,
  openBoard,
  previewDailyOperations,
  scanWithGun,
} from "../../fixtures/project/lottery-ui";
import {
  CASH_POINT_A,
  createCountStore,
} from "../../fixtures/project/scenario-count-store";
import { expect, test } from "../../fixtures/test";
import { dialogWithButton, pageArea } from "../../fixtures/ui";

/**
 * 張數店畫面的三種尺寸截圖(只截圖、不比對;`docs/testing/project/scenarios.md`「截圖」)。
 * 不是劇本:標題不含「劇本」,而且只有 `E2E_GREP` 含「截圖」時才跑,全部劇本(`pnpm e2e`)一律 skip。
 * 圖存到 `apps/e2e/.tmp/shots/`(已在 .gitignore),檔名 = 畫面-寬x高.png。
 */

const SHOTS_DIR = path.join(TMP_DIR, "shots");

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

async function shoot(
  page: Page,
  screen: string,
  size: { width: number; height: number },
): Promise<void> {
  await page.screenshot({
    path: path.join(
      SHOTS_DIR,
      `${screen}-${String(size.width)}x${String(size.height)}.png`,
    ),
    fullPage: true,
    // 對話框、底部面板有淡入:動畫直接跑完再截,不然會截到半透明
    animations: "disabled",
  });
}

test("scratch-lot 截圖:張數店畫面三種尺寸", async ({ tenant, page }) => {
  test.skip(!GREP.includes("截圖"), "只在 E2E_GREP 含「截圖」時跑");
  test.setTimeout(180_000);
  const { lottery, store } = await createCountStore(tenant);
  const main = pageArea(page);
  // 已售·未對號(虛線)、待查·未對號(待查·遺失分頁系統預設帶入那一列)
  await sellByCount(lottery.token, {
    orgId: store.orgId,
    cashPointId: store.cashPointA,
    gameId: lottery.gameId,
    count: 2,
  });
  await submitCountStocktake(lottery.token, {
    orgId: store.orgId,
    cashPointId: store.cashPointA,
    scopeLabel: CASH_POINT_A,
    gameId: lottery.gameId,
    presentCount: 3,
    investigateCount: 1,
  });
  await openBoard(page, tenant.tenantAdmin, store.orgId, CASH_POINT_A);

  for (const size of VIEWPORTS) {
    await page.setViewportSize(size);

    // 看板:展開 A 台那本(虛線格子)
    await page.goto(`/store?org=${store.orgId}`);
    const card = main
      .getByRole("button", { name: new RegExp(lottery.gameLabel) })
      .first();
    await card.click();
    await expect(page.getByText("虛線 = 系統預設帶入的張號")).toBeVisible();
    await shoot(page, "board-expanded", size);
    // 手機的展開卡片是底部面板,會蓋住標題列:Esc 收起來再按 [最近售出](電腦 / 平板是原地展開,不影響)
    await page.keyboard.press("Escape");

    // [最近售出](刷退的票)與刷退的撤銷確認視窗
    await cashPointHeader(page, CASH_POINT_A)
      .getByRole("button", { name: "最近售出" })
      .click();
    await expect(page.getByLabel("刷退的票")).toBeVisible();
    await shoot(page, "recent-sales", size);
    await scanWithGun(page, store.codeOf("006"));
    const undo = dialogWithButton(page, "撤銷");
    await expect(undo).toContainText("#006");
    await shoot(page, "return-undo-dialog", size);
    await undo.getByRole("button", { name: "取消" }).click();

    // 本的詳情(剩 N 張估算、虛線格子)
    await page.goto(`/inventory/book-page/${store.bookId}`);
    await expect(main.getByText(/估算/).first()).toBeVisible();
    await shoot(page, "book-detail", size);

    // 待查·遺失分頁:系統預設帶入那一列展開
    await page.goto("/inventory?tab=investigations");
    const table = page.getByRole("table", { name: "待查·遺失" });
    await table.getByText("系統預設帶入").first().click();
    await expect(main.getByText(/這是系統預設帶入的張號/)).toBeVisible();
    await shoot(page, "investigations-unmatched", size);

    // 營運報表預覽(日報、那家店)
    await previewDailyOperations(page, store.orgId, "南港店");
    await expect(
      main.getByRole("region", { name: "1 銷售", exact: true }),
    ).toBeVisible();
    await shoot(page, "operations-report", size);
  }
});
