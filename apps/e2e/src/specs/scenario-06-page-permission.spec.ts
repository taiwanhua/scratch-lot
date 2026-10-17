import { createDemoItemOne } from "../fixtures/api";
import {
  CREATE_PAGE_SHOW_TIPS,
  EDIT_PAGE_SHOW_HISTORY,
  SAMPLE_ONE_CREATE_ROUTE,
  SAMPLE_ONE_EDIT_ROUTE,
} from "../fixtures/demo-keys";
import { expect, test } from "../fixtures/test";
import { pageArea, signIn } from "../fixtures/ui";

/**
 * 劇本 6 — 頁面自有權限
 * 正本:`docs/testing/permission-scenarios.md`「劇本 6」。
 * 用哪一頁:示範模組1 的新增頁與編輯頁;帳號:+tenant 改矩陣(這裡走 api)、+user 看畫面。
 *
 * 要驗的是「**區塊與功能兩件事互相獨立**」:`create-page.show-tips` /
 * `edit-page.show-history` 兩筆權限**各綁在那一頁自己的模組上**(不是綁列表頁),
 * 少了區塊時那一頁本來的新增 / 編輯完全不受影響。
 */

const TIPS_REGION = "填寫提示";
const HISTORY_REGION = "變更歷程";
const LIST_CREATE_BUTTON = "+ 新增示範項目";

test("劇本 6:填寫提示與變更歷程各綁自己那一頁的權限,少了區塊不影響這一頁的 CRUD", async ({
  page,
  tenant,
}) => {
  const itemName = `頁面自有-${tenant.slug}`;
  const itemId = await createDemoItemOne(tenant.member.token, {
    name: itemName,
    note: "一般備註",
  });
  const editUrl = `${SAMPLE_ONE_EDIT_ROUTE}/${itemId}`;

  await signIn(page, tenant.member.account, tenant.member.password);

  // 兩個區塊都是 `<section aria-label=…>`(`FormTipsBlock` / `ItemHistoryBlock`),
  // 範圍限在殼的 `<main>` 內(右下角 Snackbar 不在裡面,見 `fixtures/ui.ts`)
  const tips = pageArea(page).getByRole("region", { name: TIPS_REGION });
  const history = pageArea(page).getByRole("region", { name: HISTORY_REGION });

  // 步驟 1:不給 `create-page.show-tips` → 新增頁沒有提示區塊,但照樣填得了、存得下去
  await page.goto(SAMPLE_ONE_CREATE_ROUTE);
  await expect(
    page.getByRole("heading", { name: "新增示範項目" }),
  ).toBeVisible();
  await expect(tips).toHaveCount(0);

  const createdName = `無提示新增-${tenant.slug}`;
  await page.getByLabel("名稱").fill(createdName);
  await page.getByLabel("備註", { exact: true }).fill("沒有提示區塊也填得了");
  await page.getByRole("button", { name: "儲存" }).click();
  // 儲存成功後回列表(`DemoFormPage` 的 onLeave)
  await expect(
    page.getByRole("button", { name: LIST_CREATE_BUTTON }),
  ).toBeVisible();
  await expect(pageArea(page).getByText(createdName)).toBeVisible();

  // 步驟 2:給 `show-tips` → 重進新增頁,標題下方多出提示區塊
  await tenant.setSupportPermissions({
    addPermissions: [CREATE_PAGE_SHOW_TIPS],
  });

  await page.goto(SAMPLE_ONE_CREATE_ROUTE);
  await expect(tips).toBeVisible();

  // 步驟 3:不給 `edit-page.show-history`(矩陣回到預設)→ 編輯頁沒有歷程區塊,
  //         但編輯與儲存完全正常
  await tenant.setSupportPermissions();

  await page.goto(editUrl);
  await expect(page.getByLabel("名稱")).toHaveValue(itemName);
  await expect(history).toHaveCount(0);

  const renamedName = `${itemName}-改過`;
  await page.getByLabel("名稱").fill(renamedName);
  await page.getByRole("button", { name: "儲存" }).click();
  await expect(
    page.getByRole("button", { name: LIST_CREATE_BUTTON }),
  ).toBeVisible();
  await expect(pageArea(page).getByText(renamedName)).toBeVisible();

  // 步驟 4:給 `show-history` → 重進編輯頁,表單底部多出歷程區塊,
  //         列出這筆的建立 / 編輯紀錄(新到舊)
  await tenant.setSupportPermissions({
    addPermissions: [EDIT_PAGE_SHOW_HISTORY],
  });

  await page.goto(editUrl);
  await expect(history).toBeVisible();
  await expect(history).toContainText("修改了內容");
  await expect(history).toContainText("建立");
  // 提示區塊綁的是**新增頁**自己的模組,所以編輯頁不會因為這一步冒出來
  await expect(tips).toHaveCount(0);
});
