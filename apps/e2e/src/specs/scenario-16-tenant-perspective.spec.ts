import { randomUUID } from "node:crypto";

import { MEMBER_PASSWORD, ROOT_ACCOUNT, ROOT_PASSWORD } from "../config";
import { waitForActivationToken } from "../fixtures/activation-token";
import {
  createChildOrg,
  login,
  loginRaw,
  myModuleKeys,
  orgRaw,
  provisionTenant,
  revokeTenantProvisionRaw,
  roleRaw,
  setPassword,
  tenantModuleOptionKeys,
  userRaw,
} from "../fixtures/api";
import { DEMO_GROUP, ORG_MANAGER_ROUTE } from "../fixtures/demo-keys";
import { errorCodeOf } from "../fixtures/graphql";
import { expect, test } from "../fixtures/test";
import {
  TENANT_TAG,
  confirmRevokeProvision,
  openRevokeProvisionDialog,
  orgTree,
  orgTreeRootLabels,
  orgTreeRow,
  provisionTenantInUi,
  sideNav,
  signIn,
} from "../fixtures/ui";

/**
 * 劇本 16 — 租戶視角(+ 撤銷開通)
 * 正本:`docs/testing/permission-scenarios.md`「劇本 16」與該節的「開錯可撤銷」附註;
 * 開通 / 撤銷的規則見 ADR-0009、`docs/modules/org-manager.md`「開通租戶」「撤銷開通」。
 * 帳號:root 開通與撤銷(畫面)、新租戶的首任管理員登入(畫面)。
 *
 * **不用 `tenant` fixture**:那一份開通時勾了全部模組(劇本 1–15 要示範群組),
 * 本劇本要驗的正是「開通時取消勾選示範群組」這一步,所以自己在畫面上開一個。
 */

const FIELD_MANAGER_ROUTE = "/system/field-manager";
const ORG_MANAGER_NAME = "組織管理";
const SYSTEM_GROUP_NAME = "系統管理";
/** 開通彈窗模組勾選清單上的那一列(`seeds/base/modules/demo.sub.sample-one.ts`)。 */
const DEMO_GROUP_NAME = "示範群組";
/** 根組織專屬的兩個模組:模板本來就沒綁,開通彈窗的清單裡也沒有(`provision.modulesHint`)。 */
const ROOT_ONLY_MODULE_NAMES = ["模組與權限", "資料範圍"] as const;
/** 開通出來的角色副本沿用模板名稱(`tenant-ops.service.ts`;角色清單上另掛「預設角色」標籤)。 */
const TENANT_ADMIN_ROLE_NAME = "租戶管理員";

/** 一組開通用的名稱 / 帳號(名稱帶隨機字尾,同一個資料庫上重跑不撞)。 */
function tenantIdentity(prefix: string) {
  const slug = randomUUID().slice(0, 8);
  const account = `${prefix}-${slug}`;
  return {
    name: `租戶${prefix.toUpperCase()}-${slug}`,
    // 租戶短碼要小寫英文開頭;隨機字尾是 hex,前面補 prefix
    tenantSlug: `${prefix}_${slug}`,
    account,
    email: `${account}@cookhome.test`,
  };
}

test("劇本 16:root 開通不勾示範群組的租戶 → 租戶管理員的側欄沒有平台模組與示範群組、樹根是租戶頂層、沒有開通鈕;root 看得到並標「租戶」", async ({
  page,
  rootPage,
}) => {
  const identity = tenantIdentity("c");

  // 步驟 1:root → 組織管理 →「開通租戶」,模組勾選清單取消「示範群組」→ 開通
  await signIn(rootPage, ROOT_ACCOUNT, ROOT_PASSWORD);
  await rootPage.goto(ORG_MANAGER_ROUTE);
  await provisionTenantInUi(rootPage, {
    name: identity.name,
    slug: identity.tenantSlug,
    adminEmail: identity.email,
    adminAccount: identity.account,
    uncheckModules: [DEMO_GROUP_NAME],
  });

  // 首任管理員從啟用信設密碼(e2e 的信印在 api log;設密碼頁不是本劇本要驗的,走 api)
  const ownerToken = await setPassword(
    await waitForActivationToken(identity.email),
    MEMBER_PASSWORD,
  );
  // 對照(api):副本真的沒綁示範家族,其餘照模板
  const heldModules = await myModuleKeys(ownerToken);
  expect(
    heldModules.filter(
      (key) => key === DEMO_GROUP || key.startsWith(`${DEMO_GROUP}.`),
    ),
  ).toEqual([]);
  expect(heldModules).toContain("system.org-manager");

  // 步驟 2:以新建的租戶管理員登入 → 側欄
  await signIn(page, identity.account, MEMBER_PASSWORD);
  const nav = sideNav(page);
  // 先確認系統群組確實畫出來了,「沒有某一列」的斷言才不是因為還沒載入而白綠
  await expect(
    nav.getByRole("button", { name: SYSTEM_GROUP_NAME, exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: ORG_MANAGER_NAME, exact: true }),
  ).toBeVisible();
  for (const name of [...ROOT_ONLY_MODULE_NAMES, DEMO_GROUP_NAME]) {
    await expect(nav.getByText(name, { exact: true })).toHaveCount(0);
  }

  // 組織樹以租戶頂層為根、頂層不掛「租戶」標籤;沒有「開通租戶」按鈕(「+ 子組織」在,是同步點)
  await page.goto(ORG_MANAGER_ROUTE);
  await expect(
    orgTree(page).getByText(identity.name, { exact: true }),
  ).toBeVisible();
  expect(await orgTreeRootLabels(page)).toEqual([identity.name]);
  await expect(
    orgTreeRow(page, identity.name).getByText(TENANT_TAG, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "+ 子組織", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "開通租戶", exact: true }),
  ).toHaveCount(0);

  // 欄位管理頁的全域選項是唯讀(第一個類別「性別」的種子選項:開關停用、操作欄講明誰在管)
  await page.goto(FIELD_MANAGER_ROUTE);
  const options = page.getByRole("table", { name: "選項清單" });
  const male = options
    .getByRole("row")
    .filter({ has: page.getByText("男", { exact: true }) });
  await expect(male.getByRole("switch", { name: "啟用「男」" })).toBeDisabled();
  await expect(
    male.getByText("由系統管理員維護", { exact: true }),
  ).toBeVisible();

  // 步驟 3:回 root 視角 → 組織管理的樹上看得到新租戶,並標「租戶」
  await rootPage.goto(ORG_MANAGER_ROUTE);
  await expect(
    orgTreeRow(rootPage, identity.name).getByText(TENANT_TAG, {
      exact: true,
    }),
  ).toBeVisible();
  expect(await orgTreeRootLabels(rootPage)).not.toContain(identity.name);
});

test("劇本 16:撤銷開通 —— 空的租戶照打名稱即抹掉三樣、同一組帳號可再開通;租戶底下有子組織時被擋並列出原因", async ({
  page,
}) => {
  // 前置(api):root 開兩個租戶,一個保持空的、一個底下建一個子組織
  const rootToken = await login(ROOT_ACCOUNT, ROOT_PASSWORD);
  const moduleKeys = await tenantModuleOptionKeys(rootToken);
  const empty = tenantIdentity("d");
  const emptyInput = {
    name: empty.name,
    slug: empty.tenantSlug,
    adminAccount: empty.account,
    adminEmail: empty.email,
    moduleKeys,
  };
  const emptyTenant = await provisionTenant(rootToken, emptyInput);

  const busy = tenantIdentity("e");
  const busyTenant = await provisionTenant(rootToken, {
    name: busy.name,
    slug: busy.tenantSlug,
    adminAccount: busy.account,
    adminEmail: busy.email,
    moduleKeys,
  });
  await createChildOrg(rootToken, busyTenant.orgId, "南港店");

  // 空的租戶:root 選租戶頂層 →「撤銷開通」→ 彈窗列出三樣 → 照打名稱才按得下去
  await signIn(page, ROOT_ACCOUNT, ROOT_PASSWORD);
  await page.goto(ORG_MANAGER_ROUTE);
  const dialog = await openRevokeProvisionDialog(page, empty.name);
  await expect(dialog).toContainText(`租戶組織「${empty.name}」`);
  await expect(dialog).toContainText(`擁有者帳號「${empty.account}」`);
  await expect(dialog).toContainText(`角色副本「${TENANT_ADMIN_ROLE_NAME}」`);
  await confirmRevokeProvision(dialog, empty.name);
  await expect(dialog).toBeHidden();

  // 三樣消失:樹上沒有、api 查三者都是 NOT_FOUND、帳號登不進來
  await expect(orgTreeRow(page, busy.name)).toBeVisible();
  await expect(orgTreeRow(page, empty.name)).toHaveCount(0);
  expect(errorCodeOf(await orgRaw(rootToken, emptyTenant.orgId))).toBe(
    "NOT_FOUND",
  );
  expect(errorCodeOf(await userRaw(rootToken, emptyTenant.ownerUserId))).toBe(
    "NOT_FOUND",
  );
  expect(errorCodeOf(await roleRaw(rootToken, emptyTenant.roleId))).toBe(
    "NOT_FOUND",
  );
  expect(errorCodeOf(await loginRaw(empty.account, MEMBER_PASSWORD))).toBe(
    "INVALID_CREDENTIALS",
  );

  // 同一組名稱 / 帳號 / Email 可以重新開通(硬刪除,沒有殭屍卡住唯一索引)
  const reprovisioned = await provisionTenant(rootToken, emptyInput);
  expect(reprovisioned.orgId).not.toBe(emptyTenant.orgId);

  // 有子組織的租戶:送出後被擋,彈窗改列原因、不再給送出鈕
  const blocked = await openRevokeProvisionDialog(page, busy.name);
  await confirmRevokeProvision(blocked, busy.name);
  await expect(blocked).toContainText("這個租戶還不能撤銷開通,原因如下:");
  await expect(
    blocked.getByText("還有下層組織", { exact: true }),
  ).toBeVisible();
  await expect(
    blocked.getByRole("button", { name: "撤銷開通", exact: true }),
  ).toHaveCount(0);

  // api:PROVISION_NOT_REVOKABLE 附 reasons(與刪除同一組語彙);租戶還在
  const refused = await revokeTenantProvisionRaw(rootToken, busyTenant.orgId);
  expect(errorCodeOf(refused)).toBe("PROVISION_NOT_REVOKABLE");
  expect(refused.errors?.[0]?.extensions?.reasons).toEqual(["HAS_CHILDREN"]);
  expect(errorCodeOf(await orgRaw(rootToken, busyTenant.orgId))).toBeNull();
});
