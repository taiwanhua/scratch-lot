import { ROOT_ACCOUNT, ROOT_PASSWORD } from "../config";
import {
  DEMO_FORM_ROUTE,
  DEMO_FORM_VIEW_ROUTE,
  FORMS_ROUTE,
  formKeyOf,
} from "../fixtures/api";
import {
  clickAndWaitForOperation,
  createButton,
  expectCreateEnabled,
  grantDemoForm,
} from "../fixtures/scenario-forms";
import { expect, test } from "../fixtures/test";
import { chooseOption, pageArea, signIn } from "../fixtures/ui";

/**
 * 劇本 18 — 表單生命週期(建立 → 設計 → 發布 → 分派 → 填寫 → 列表 / 詳情)
 * 正本:`docs/testing/permission-scenarios.md`「劇本 18」。
 * 用哪一頁:表單管理(root)+ 示範表單(頂層)列表 / 新增 / 詳情(+user)。
 * 前置(走 api):「客服」角色另勾示範表單(頂層)的四個動作(`grantDemoForm`)。
 */
test("劇本 18:root 建表單、設計、發布、分派;員工填寫送出,列表與詳情看得到", async ({
  page,
  rootPage,
  tenant,
}) => {
  test.setTimeout(180_000);
  await grantDemoForm(tenant);
  const formKey = formKeyOf("e2e18", tenant.slug);
  const formName = `購物單-${tenant.slug}`;
  const itemLabel = "品項";
  const itemValue = `雞蛋-${tenant.slug}`;

  // 步驟 1:root → 表單管理 →「+ 建立表單」
  await signIn(rootPage, ROOT_ACCOUNT, ROOT_PASSWORD);
  await rootPage.goto(FORMS_ROUTE);
  await rootPage.getByRole("button", { name: "+ 建立表單" }).click();
  const createDialog = rootPage.getByRole("dialog", { name: "建立表單" });
  await createDialog.getByRole("textbox", { name: "表單 key" }).fill(formKey);
  await createDialog.getByRole("textbox", { name: "名稱" }).fill(formName);
  await chooseOption(rootPage, "所屬模組", "示範表單(頂層)");
  await clickAndWaitForOperation(
    rootPage,
    createDialog.getByRole("button", { name: "建立" }),
    "CreateForm",
  );

  // 步驟 2:設計 → 開新草稿 → 從元件面板加單行文字欄位、改顯示名稱、摘要標題指到它 → 存草稿
  const detail = rootPage.getByRole("region", { name: "表單設定" });
  await expect(detail.getByRole("heading", { name: formName })).toBeVisible();
  await clickAndWaitForOperation(
    rootPage,
    detail.getByRole("button", { name: "開新草稿" }),
    "CreateFormVersionDraft",
  );
  await detail.getByRole("button", { name: "新增單行文字欄位" }).click();
  const label = detail.getByRole("textbox", { name: "顯示名稱" });
  await label.fill(itemLabel);
  await detail.getByRole("button", { name: "← 表單設定" }).click();
  await chooseOption(rootPage, "標題", `${itemLabel}(field_1)`);
  await clickAndWaitForOperation(
    rootPage,
    detail.getByRole("button", { name: "存草稿" }),
    "SaveFormVersionDraft",
  );

  // 步驟 3:版本 → 發布(填變更說明)
  await detail.getByRole("tab", { name: "表單版本" }).click();
  const versions = detail.getByRole("table", { name: "版本清單" });
  await versions.getByRole("button", { name: "發布" }).click();
  const publishDialog = rootPage.getByRole("dialog", { name: "發布新版本" });
  await publishDialog.getByRole("textbox", { name: "變更說明" }).fill("第一版");
  await clickAndWaitForOperation(
    rootPage,
    publishDialog.getByRole("button", { name: "發布" }),
    "PublishFormVersion",
  );
  await expect(versions.getByText("v1", { exact: true })).toBeVisible();
  await expect(versions.getByText("已發布")).toBeVisible();

  // 分派之前:+user 在示範表單(頂層)沒有可填的表單 → 新增鈕停用
  await signIn(page, tenant.member.account, tenant.member.password);
  await page.goto(DEMO_FORM_ROUTE);
  await expectCreateEnabled(page, false);

  // 步驟 4:root →「分派租戶」→ 勾租戶A → 儲存
  await detail.getByRole("button", { name: "分派租戶" }).click();
  const assignDialog = rootPage.getByRole("dialog", {
    name: `分派「${formName}」`,
  });
  await assignDialog.getByLabel(tenant.tenantOrgName, { exact: true }).check();
  await clickAndWaitForOperation(
    rootPage,
    assignDialog.getByRole("button", { name: "儲存" }),
    "AssignFormToTenants",
  );

  // 步驟 5:+user → 示範表單(頂層) →「+ 新增」(只有這一張 → 直接進填寫頁)→ 填寫 → 送出
  await page.goto(DEMO_FORM_ROUTE);
  await expectCreateEnabled(page, true);
  await createButton(page).click();
  await expect(
    pageArea(page).getByRole("heading", { name: `新增 — ${formName}` }),
  ).toBeVisible();
  await pageArea(page)
    .getByRole("textbox", { name: itemLabel })
    .fill(itemValue);
  await clickAndWaitForOperation(
    page,
    pageArea(page).getByRole("button", { name: "送出" }),
    // 新增頁還沒存過草稿:建立與送出是同一個請求(useFormDraft 的 createAndSubmit)
    "CreateAndSubmitFormSubmission",
  );

  // 送出後到詳情頁:標題 = 摘要槽(填的值)、值看得到;狀態在「修訂紀錄」跳窗裡(已完成)
  await page.waitForURL((url) => url.pathname.startsWith(DEMO_FORM_VIEW_ROUTE));
  await expect(
    pageArea(page).getByRole("heading", { name: itemValue }),
  ).toBeVisible();
  await pageArea(page).getByRole("button", { name: "修訂紀錄" }).click();
  const history = page.getByRole("dialog");
  await expect(history.getByText("已完成")).toBeVisible();
  await history.getByRole("button", { name: "關閉" }).click();

  // 步驟 6:回列表,那一筆的標題欄就是填的值,狀態已完成
  await page.goto(DEMO_FORM_ROUTE);
  const row = pageArea(page).getByRole("row").filter({ hasText: itemValue });
  await expect(row).toBeVisible();
  await expect(row.getByText("已完成")).toBeVisible();
});
