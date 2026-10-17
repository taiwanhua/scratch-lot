import { ROOT_ACCOUNT, ROOT_PASSWORD } from "../config";
import {
  DATA_SCOPE_ROUTE,
  DEMO_ITEMS_ONE_COLLECTION,
  SAMPLE_ONE_EDIT_ROUTE,
  SAMPLE_ONE_LIST_ROUTE,
  SAMPLE_ONE_VIEW_ROUTE,
} from "../fixtures/demo-keys";
import { createScenarioDemoItems } from "../fixtures/scenario-demo-items";
import { expect, test } from "../fixtures/test";
import { clickAndWaitFor, expectDemoItems, signIn } from "../fixtures/ui";

/**
 * 劇本 2 — 資料範圍規則
 * 正本:`docs/testing/permission-scenarios.md`「劇本 2」。
 * 用哪一頁:「資料範圍」頁(建規則)+ 示範模組1 列表 / 詳情(看結果);
 * 帳號:規則用 **root**(資料範圍是根組織專屬模組)、結果用 **+user**。
 *
 * 兩個帳號要**同時**在線(root 改規則、+user 立刻重新整理看結果),所以
 * +user 用預設的 `page`、root 用自己一個 context 的 `rootPage`(見 `fixtures/test.ts`)。
 */

const NOT_FOUND_ALERT =
  "找不到這筆示範項目,可能已被刪除,或不在你看得到的範圍內。";
const CATEGORY_UNAVAILABLE = "需要「欄位管理」的檢視權限才能挑選分類。";
const SAVED = "已儲存資料範圍規則。";
const HAS_RULE_TAG = "已設規則";

test("劇本 2:規則命中客服 → 只見自建;刪規則 → 恢復可見範圍", async ({
  page,
  rootPage,
  tenant,
}) => {
  const items = await createScenarioDemoItems(tenant);

  // 步驟 1:+user 先看一次列表 —— 自己 2 筆 +「南港-他人」;「頂層-他人」看不到
  await signIn(page, tenant.member.account, tenant.member.password);
  await page.goto(SAMPLE_ONE_LIST_ROUTE);
  await expectDemoItems(page, {
    total: 3,
    visible: items.memberVisibleOne,
    hidden: [items.peerAtTenantTop.name],
  });

  // 同一步的另一半:「客服」沒有 `system.field-manager.view`,所以列表沒有分類篩選、
  // 表單的分類欄退成唯讀並說明原因(原值保留)
  await expect(page.getByRole("combobox", { name: "分類" })).toHaveCount(0);
  await page.goto(`${SAMPLE_ONE_EDIT_ROUTE}/${items.ownedOne.id}`);
  await expect(page.getByLabel("分類")).toBeDisabled();
  await expect(page.getByText(CATEGORY_UNAVAILABLE)).toBeVisible();

  // 步驟 2:root → 資料範圍 → 左清單選「示範項目」→ 新增一條規則
  //(套用對象 = 指定角色「客服」、建立者 屬於【操作者本人】)→ 儲存
  await signIn(rootPage, ROOT_ACCOUNT, ROOT_PASSWORD);
  await rootPage.goto(DATA_SCOPE_ROUTE);
  await rootPage.getByText(DEMO_ITEMS_ONE_COLLECTION, { exact: true }).click();
  await expect(rootPage.getByText(HAS_RULE_TAG)).toHaveCount(0);

  await rootPage.getByRole("button", { name: "+ 新增規則" }).click();
  // 規則卡分上下兩塊:套用對象(人員條件)與條件組合,兩塊都有「欄位」「值」,一律在區塊內找
  const audience = rootPage.getByRole("region", { name: "套用對象" });
  const conditions = rootPage.getByRole("region", { name: "條件組合" });
  await audience.getByRole("radio", { name: "符合條件" }).check();
  await audience.getByRole("combobox", { name: "欄位", exact: true }).click();
  await rootPage.getByRole("option", { name: "角色", exact: true }).click();
  // 每個租戶都有一個「客服」,主文字一模一樣 —— 用次文字(擁有組織)挑自己這一個
  await audience
    .getByRole("combobox", { name: "值", exact: true })
    .fill("客服");
  await rootPage
    .getByRole("option")
    .filter({ hasText: tenant.tenantOrgName })
    .click();
  await rootPage.keyboard.press("Escape");
  // 新規則的條件列預設是第一個欄位(狀態),改成「建立者 屬於【操作者本人】」
  await conditions.getByRole("combobox", { name: "欄位", exact: true }).click();
  await rootPage.getByRole("option", { name: "建立者", exact: true }).click();
  await conditions.getByRole("combobox", { name: "值", exact: true }).click();
  await rootPage
    .getByRole("option", { name: "【操作者本人】", exact: true })
    .click();
  await rootPage.keyboard.press("Escape");
  await clickAndWaitFor(rootPage, "儲存", "SaveDataScopeRule");
  await expect(rootPage.getByText(SAVED)).toBeVisible();
  await expect(rootPage.getByText(HAS_RULE_TAG)).toBeVisible();

  // 步驟 3:+user 重新整理列表 → 只剩自己建的 2 筆,`totalCount` 一併變小
  await page.goto(SAMPLE_ONE_LIST_ROUTE);
  await expectDemoItems(page, {
    total: 2,
    visible: [items.ownedOne.name, items.ownedTwo.name],
    hidden: [items.peerInNangang.name, items.peerAtTenantTop.name],
  });

  // 步驟 4:點進被濾掉那筆的詳情網址 → 查無資料(列表與單筆同一個答案,不透露存在與否)
  await page.goto(`${SAMPLE_ONE_VIEW_ROUTE}/${items.peerInNangang.id}`);
  await expect(page.getByText(NOT_FOUND_ALERT)).toBeVisible();

  // 預期的最後一句:root 自己不受影響(套用對象是「客服」角色,超級管理員的可見範圍是全部)。
  // root 的列表跨租戶、不只一頁,所以用工具列的搜尋把那一筆撈出來
  await rootPage.goto(SAMPLE_ONE_LIST_ROUTE);
  await rootPage.getByLabel("搜尋").fill(items.peerInNangang.name);
  await expectDemoItems(rootPage, {
    total: 1,
    visible: [items.peerInNangang.name],
  });

  // 步驟 5:root 回資料範圍頁把規則刪掉 → 儲存
  await rootPage.goto(DATA_SCOPE_ROUTE);
  await rootPage.getByText(DEMO_ITEMS_ONE_COLLECTION, { exact: true }).click();
  await expect(rootPage.getByText(HAS_RULE_TAG)).toBeVisible();
  await rootPage.getByRole("button", { name: "刪除規則" }).click();
  await clickAndWaitFor(rootPage, "儲存", "SaveDataScopeRule");
  // `rules: []` = 沒有規則(左清單的「已設規則」跟著不見)
  await expect(rootPage.getByText(HAS_RULE_TAG)).toHaveCount(0);

  // 步驟 5 的預期:恢復成步驟 1 的三筆
  await page.goto(SAMPLE_ONE_LIST_ROUTE);
  await expectDemoItems(page, {
    total: 3,
    visible: items.memberVisibleOne,
    hidden: [items.peerAtTenantTop.name],
  });
});
