import {
  type Locator,
  type Page,
  type Response,
  expect,
} from "@playwright/test";

import { chooseOption, signIn } from "../ui";

/** 店面管理的畫面操作(TEST-11:共用動作抽在這裡)。 */

const STORE_ROUTE = "/store";

/**
 * 條碼槍:條碼槍就是快速鍵盤輸入 + Enter(`useScanner` 的 `scanner-detector.ts`:字元間隔 30 毫秒內、6 碼以上)。
 * `injectScan` 只在 bundle 內,這裡走真的 keydown,也順便驗到全域掃描的分派(看板 / [最近售出] 誰優先)。
 * 在頁面裡一次發完,不用 `page.keyboard.type`:後者一個字元一趟來回,CI 慢時間隔超過門檻就不算掃描。
 */
export async function scanWithGun(page: Page, code: string): Promise<void> {
  await page.evaluate((text) => {
    const target = document.activeElement ?? document.body;
    const press = (key: string) => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    };
    for (const key of text) {
      press(key);
    }
    press("Enter");
  }, code);
}

/** 等一次 GraphQL 操作回來(Snackbar 不是同步點,TEST-11)。 */
export function waitForOperation(
  page: Page,
  operationName: string,
): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.url().includes("/graphql") &&
      (response.request().postData() ?? "").includes(operationName),
  );
}

/** 登入、進看板、把這台裝置的本機收銀點設成 `cashPointName`。 */
export async function openBoard(
  page: Page,
  person: { account: string; password: string },
  orgId: string,
  cashPointName: string,
): Promise<void> {
  await signIn(page, person.account, person.password);
  await page.goto(`${STORE_ROUTE}?org=${orgId}`);
  await chooseOption(page, "本機收銀點", cashPointName);
  await expect(cashPointHeader(page, cashPointName)).toContainText("本機");
}

/** 看板上某個收銀點的標題列(`CashPointHeader`;開班中才有「本班已售」)。 */
export function cashPointHeader(page: Page, name: string): Locator {
  return page
    .locator(".MuiCard-root.MuiPaper-outlined")
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ hasText: "本班已售" });
}

/** 標題列的「本班已售」(期初零用金 0:應有現金跟賣的錢一樣)。 */
export async function expectSold(
  page: Page,
  cashPointName: string,
  count: number,
  amount: number,
): Promise<void> {
  await expect(cashPointHeader(page, cashPointName)).toContainText(
    `${String(count)} 張 / ${amount.toLocaleString("en-US")}`,
  );
}

/** 右下角的提示內容(同一句也會出現在 `role=status` 的無障礙播報裡,所以只找 Alert 那一份)。 */
export function snackbar(page: Page, text: string | RegExp): Locator {
  return page.locator(".MuiAlert-message").filter({ hasText: text });
}

/** 台北今天(`YYYY-MM-DD`;報表的日報條件)。 */
export function taipeiToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 輸出報表 → 營運報表、日報、那家店 → [預覽],切到那家店的工作表。 */
export async function previewDailyOperations(
  page: Page,
  orgId: string,
  storeName: string,
): Promise<void> {
  const conditions = {
    period: { kind: "day", date: taipeiToday() },
    orgIds: [orgId],
    extra: {},
  };
  await page.goto(
    `/reports?report=operations&conditions=${encodeURIComponent(JSON.stringify(conditions))}`,
  );
  await Promise.all([
    waitForOperation(page, "Operations"),
    page.getByRole("button", { name: "預覽" }).click(),
  ]);
  const tab = page.getByRole("tab", { name: new RegExp(storeName) });
  if ((await tab.count()) > 0) {
    await tab.first().click();
  }
}
