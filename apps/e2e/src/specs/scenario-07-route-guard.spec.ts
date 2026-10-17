import { createDemoItemOne } from "../fixtures/api";
import {
  SAMPLE_ONE_CREATE,
  SAMPLE_ONE_CREATE_PAGE,
  SAMPLE_ONE_CREATE_ROUTE,
  SAMPLE_ONE_LIST_ROUTE,
  SAMPLE_ONE_VIEW_ROUTE,
} from "../fixtures/demo-keys";
import { expect, test } from "../fixtures/test";
import { expectForbiddenPage, pageAlert, signIn } from "../fixtures/ui";

/**
 * 劇本 7 — 路由防守
 * 正本:`docs/testing/permission-scenarios.md`「劇本 7」。
 * 用哪一頁:示範模組1 列表 + 直接在網址列打三種網址;帳號:+tenant 改矩陣(走 api)、+user 試網址。
 *
 * 要驗的是「**頁(模組)與功能(權限)是兩層,分開問**」:
 * 沒綁模組 → 連頁都進不去;綁了模組但沒有 `create` → 頁進得去、送出被 api 擋。
 */

const CREATE_BUTTON = "+ 新增示範項目";
const NO_PERMISSION = "你沒有執行這個動作的權限。";

test("劇本 7:沒綁新增頁 → 手打網址被擋;綁了頁沒有 create → 進得去、送出被擋", async ({
  page,
  tenant,
}) => {
  const itemName = `路由防守-${tenant.slug}`;
  const itemId = await createDemoItemOne(tenant.member.token, {
    name: itemName,
  });

  // 步驟 1:角色**不綁**新增頁模組
  await tenant.setSupportPermissions({
    omitModules: [SAMPLE_ONE_CREATE_PAGE],
  });
  await signIn(page, tenant.member.account, tenant.member.password);

  await page.goto(SAMPLE_ONE_LIST_ROUTE);
  await expect(page.getByText(itemName)).toBeVisible();
  await expect(page.getByRole("button", { name: CREATE_BUTTON })).toHaveCount(
    0,
  );

  await page.goto(SAMPLE_ONE_CREATE_ROUTE);
  await expectForbiddenPage(page);

  // 步驟 2:綁了新增頁模組、但**不給** `create` 權限 → 頁進得去,送出被 api 擋
  await tenant.setSupportPermissions({
    omitPermissions: [SAMPLE_ONE_CREATE],
  });

  await page.goto(SAMPLE_ONE_LIST_ROUTE);
  // 沒有 `create` 權限,列表上一樣沒有新增鈕(頁綁了不代表做得了)
  await expect(page.getByRole("button", { name: CREATE_BUTTON })).toHaveCount(
    0,
  );

  await page.goto(SAMPLE_ONE_CREATE_ROUTE);
  await expect(
    page.getByRole("heading", { name: "新增示範項目" }),
  ).toBeVisible();
  await page.getByLabel("名稱").fill(`擋下來-${tenant.slug}`);
  await page.getByRole("button", { name: "儲存" }).click();
  // 同一句話會同時出現在頁內橫幅與右下角 Snackbar(#376),所以只看 `<main>` 裡的那一則
  await expect(pageAlert(page)).toHaveText(NO_PERMISSION);

  // 步驟 3:綁了詳情頁模組 → 手打帶 id 的網址進得去,解出來的就是那一筆
  await page.goto(`${SAMPLE_ONE_VIEW_ROUTE}/${itemId}`);
  await expect(page.getByRole("heading", { name: itemName })).toBeVisible();

  // 步驟 4:列表頁(link 模組)後面多接一段 → 無權限頁
  //(尾端動態參數的退路只對 hidden 模組成立,ADR-0011「路由防守」)
  await page.goto(`${SAMPLE_ONE_LIST_ROUTE}/whatever`);
  await expectForbiddenPage(page);
});
