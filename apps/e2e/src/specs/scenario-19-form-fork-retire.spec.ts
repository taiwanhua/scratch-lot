import {
  DEMO_FORM_CREATE_ROUTE,
  DEMO_FORM_ROUTE,
  DEMO_FORM_VIEW_ROUTE,
  FORMS_ROUTE,
  createFormDraftRaw,
  formKeyOf,
  moduleFormKeys,
  oneTextFieldDefinition,
  publishSharedForm,
} from "../fixtures/api";
import { errorCodeOf, errorReasonOf } from "../fixtures/graphql";
import {
  clickAndWaitForOperation,
  createButton,
  expectCreateEnabled,
  grantDemoForm,
} from "../fixtures/scenario-forms";
import { expect, test } from "../fixtures/test";
import { pageArea, signIn } from "../fixtures/ui";

/**
 * 劇本 19 — 客製副本與退役目前版本
 * 正本:`docs/testing/permission-scenarios.md`「劇本 19」。
 * 用哪一頁:表單管理(+tenant)+ 示範表單(頂層)新增(+user)。
 * 前置(走 api):root 建共用表單、發布、分派給租戶A;「客服」角色另勾示範表單(頂層)的四個動作。
 */
test("劇本 19:以分派來的表單為基底建客製表單並發布;退役目前版本後不能再新增", async ({
  page,
  rootPage,
  tenant,
}) => {
  test.setTimeout(180_000);
  const sharedKey = formKeyOf("e2e19s", tenant.slug);
  const sharedName = `共用購物單-${tenant.slug}`;
  const customKey = formKeyOf("e2e19c", tenant.slug);
  const customName = `門市購物單-${tenant.slug}`;
  const itemValue = `牛奶-${tenant.slug}`;
  await publishSharedForm(tenant.rootToken, {
    key: sharedKey,
    name: sharedName,
    definition: oneTextFieldDefinition("item", "品項"),
    tenantOrgIds: [tenant.tenantOrgId],
  });
  await grantDemoForm(tenant);

  // 步驟 1:+tenant → 表單管理 → 選分派來的表單 →「以此為基底建新表單」
  const admin = rootPage;
  await signIn(admin, tenant.tenantAdmin.account, tenant.tenantAdmin.password);
  await admin.goto(FORMS_ROUTE);
  const list = admin.getByRole("region", { name: "表單清單" });
  await list.getByText(sharedName, { exact: true }).click();
  const detail = admin.getByRole("region", { name: "表單設定" });
  await expect(detail.getByRole("heading", { name: sharedName })).toBeVisible();
  await detail.getByRole("button", { name: "以此為基底建新表單" }).click();
  const forkDialog = admin.getByRole("dialog", {
    name: `以「${sharedName}」為基底建新表單`,
  });
  await expect(
    forkDialog.getByText("建立後不可修改", { exact: false }),
  ).toBeVisible();
  await forkDialog.getByRole("textbox", { name: "新表單 key" }).fill(customKey);
  await forkDialog.getByRole("textbox", { name: "名稱" }).fill(customName);
  await clickAndWaitForOperation(
    admin,
    forkDialog.getByRole("button", { name: "建立" }),
    "ForkForm",
  );
  await expect(detail.getByRole("heading", { name: customName })).toBeVisible();
  await expect(
    list.getByRole("button").filter({ hasText: customName }).getByText("客製"),
  ).toBeVisible();

  // 步驟 2:改欄位(加一個數字欄位「數量」)→ 存草稿 → 發布
  await detail.getByRole("button", { name: "新增數字欄位" }).click();
  await detail.getByRole("textbox", { name: "顯示名稱" }).fill("數量");
  await clickAndWaitForOperation(
    admin,
    detail.getByRole("button", { name: "存草稿" }),
    "SaveFormVersionDraft",
  );
  await detail.getByRole("tab", { name: "表單版本" }).click();
  const versions = detail.getByRole("table", { name: "版本清單" });
  await versions.getByRole("button", { name: "發布" }).click();
  const publishDialog = admin.getByRole("dialog", { name: "發布新版本" });
  await publishDialog.getByRole("textbox", { name: "變更說明" }).fill("加數量");
  await clickAndWaitForOperation(
    admin,
    publishDialog.getByRole("button", { name: "發布" }),
    "PublishFormVersion",
  );
  await expect(versions.getByText("已發布")).toBeVisible();

  // 步驟 3:+user →「+ 新增」:共用與客製都在選單裡;選客製表單,看得到加的欄位,填寫送出
  await signIn(page, tenant.member.account, tenant.member.password);
  await page.goto(DEMO_FORM_ROUTE);
  await expectCreateEnabled(page, true);
  await createButton(page).click();
  const picker = page.getByRole("dialog", { name: "選擇要填寫的表單" });
  await expect(picker.getByText(sharedName, { exact: true })).toBeVisible();
  await picker.getByText(customName, { exact: true }).click();
  await expect(
    pageArea(page).getByRole("heading", { name: `新增 — ${customName}` }),
  ).toBeVisible();
  await pageArea(page).getByRole("textbox", { name: "品項" }).fill(itemValue);
  await pageArea(page).getByRole("textbox", { name: "數量" }).fill("2");
  await clickAndWaitForOperation(
    page,
    pageArea(page).getByRole("button", { name: "送出" }),
    // 新增頁還沒存過草稿:建立與送出是同一個請求(useFormDraft 的 createAndSubmit)
    "CreateAndSubmitFormSubmission",
  );
  await page.waitForURL((url) => url.pathname.startsWith(DEMO_FORM_VIEW_ROUTE));

  // 步驟 4:+tenant → 客製表單的「版本」→「退役目前版本」並確認
  await versions.getByRole("button", { name: "退役目前版本" }).click();
  const retireDialog = admin.getByRole("dialog", { name: "退役目前版本?" });
  await clickAndWaitForOperation(
    admin,
    retireDialog.getByRole("button", { name: "退役" }),
    "RetireCurrentVersion",
  );

  // 步驟 5:+user 再按「+ 新增」:客製表單不在選單裡(只剩共用表單 → 直接進它的填寫頁)
  expect(await moduleFormKeys(tenant.member.token)).toEqual([sharedKey]);
  await page.goto(DEMO_FORM_ROUTE);
  await expectCreateEnabled(page, true);
  await createButton(page).click();
  await expect(
    pageArea(page).getByRole("heading", { name: `新增 — ${sharedName}` }),
  ).toBeVisible();
  // 直接打客製表單的新增網址 → 說明現在不能新增
  await page.goto(`${DEMO_FORM_CREATE_ROUTE}/${customKey}`);
  await expect(
    pageArea(page).getByText("這張表單目前不能新增", { exact: false }),
  ).toBeVisible();
  // api 也擋(畫面上驗不到的那一層)
  const denied = await createFormDraftRaw(tenant.member.token, customKey);
  expect(errorCodeOf(denied)).toBe("FORBIDDEN");
  expect(errorReasonOf(denied)).toBe("FORM_NOT_AVAILABLE");

  // 已送出的那一筆照常看得到
  await page.goto(DEMO_FORM_ROUTE);
  await expect(
    pageArea(page).getByRole("row").filter({ hasText: itemValue }),
  ).toBeVisible();
});
