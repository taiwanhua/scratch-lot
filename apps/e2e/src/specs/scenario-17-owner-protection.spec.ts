import {
  deleteOrgRaw,
  moveOrgRaw,
  revokeRoleUsersRaw,
  setOrgEnabledRaw,
  setUserEnabledRaw,
  setUserOrgsRaw,
  userById,
} from "../fixtures/api";
import {
  ORG_MANAGER_ROUTE,
  ROLE_MANAGER_ROUTE,
  USER_MANAGER_ROUTE,
} from "../fixtures/demo-keys";
import { errorCodeOf } from "../fixtures/graphql";
import { grantMemberGovernanceRole } from "../fixtures/scenario-management-scope";
import type { ScenarioTenant } from "../fixtures/scenario-tenant";
import { expect, test } from "../fixtures/test";
import {
  MOVE_TARGET_SELECT,
  TENANT_TOP_HINT,
  dialogWithButton,
  openEditOrgDialog,
  orgDetail,
  orgTreeCheckbox,
  signIn,
  userRow,
} from "../fixtures/ui";

/**
 * 劇本 17 — 擁有者保護
 * 正本:`docs/testing/permission-scenarios.md`「劇本 17」;規則見 ADR-0009「租戶擁有者」、
 * `docs/modules/user-manager.md`(停用 / 所屬組織的擁有者保護、`LAST_ORG`)、
 * `docs/modules/role-manager.md`(`revokeRoleUsers` 的 `OWNER_PROTECTED`)、
 * `docs/modules/org-manager.md`「租戶頂層保護」。
 * 帳號:+tenant(= 租戶擁有者)操作自己、+user 另拿治理角色對照「租戶內任何人」、root 覆核。
 *
 * 預期是錯誤碼,所以每一步都打 api 斷言(TEST-11);畫面上「先鎖住、並說明為什麼」的那幾處
 * (停用鈕、所屬組織彈窗的樹根、分配使用者的「移除」、組織管理的停用 / 刪除 / 上層組織)一併看。
 *
 * **前置的第二個所屬組織**:`scenario-tenant.ts` 第 3 步已把 +tenant 加進南港店,
 * 所以 +tenant 的所屬組織 = 租戶頂層 + 南港店。「移出租戶頂層」要驗的是擁有者保護,
 * 不能先撞上 `LAST_ORG`(最後一個所屬組織不可移除,檢查順序在擁有者保護之前)——
 * 每個 test 開頭都先斷一次這個前置。
 */

/** 開通出來的角色副本沿用模板名稱;角色清單上另掛「預設角色」標籤。 */
const TENANT_ADMIN_ROLE_NAME = "租戶管理員";
/** 所屬組織彈窗裡鎖住節點的說明(`admin.userManager.orgPicker.ownerLocked`,#426)。 */
const OWNER_LOCKED_HINT =
  "頂層組織的擁有者不能被移出頂層組織;其他組織可自由勾選或取消。";
/** 分配使用者那一列的標籤(`admin.roleManager.users.ownerProtected`)。 */
const OWNER_PROTECTED_TAG = "擁有者保護";

/** +tenant 身上的預設角色(租戶管理員副本)的 id;開通回傳過,但 `ScenarioTenant` 沒有帶出來。 */
async function tenantAdminRoleId(tenant: ScenarioTenant): Promise<string> {
  const owner = await userById(
    tenant.tenantAdmin.token,
    tenant.tenantAdmin.userId,
  );
  const role = owner.roles.find((held) => held.name === TENANT_ADMIN_ROLE_NAME);
  if (role === undefined) {
    throw new Error("+tenant 身上找不到租戶管理員副本");
  }
  return role.id;
}

const byId = (left: string, right: string) => left.localeCompare(right);

/** 前置:擁有者的所屬組織 = 租戶頂層 + 南港店(見檔頭)。 */
async function expectOwnerHasSecondOrg(tenant: ScenarioTenant): Promise<void> {
  const owner = await userById(tenant.rootToken, tenant.tenantAdmin.userId);
  expect(owner.orgs.map((org) => org.id).toSorted(byId)).toEqual(
    [tenant.tenantOrgId, tenant.nangangOrgId].toSorted(byId),
  );
}

test("劇本 17:①+tenant 對自己(擁有者)停用 / 移出租戶頂層 / 解除預設角色 → 畫面先鎖住,api 回 OWNER_PROTECTED", async ({
  page,
  tenant,
}) => {
  const { tenantAdmin, tenantOrgName } = tenant;
  const self = tenantAdmin.userId;
  const copyRoleId = await tenantAdminRoleId(tenant);
  await expectOwnerHasSecondOrg(tenant);

  await signIn(page, tenantAdmin.account, tenantAdmin.password);

  // 使用者管理:自己那一列的「停用」停用
  await page.goto(USER_MANAGER_ROUTE);
  const row = userRow(page, tenantAdmin.account);
  await expect(
    row.getByRole("button", { name: "停用", exact: true }),
  ).toBeDisabled();

  // 「所屬組織」照常開得了,但樹根(= 自己擁有的租戶頂層)鎖在勾選狀態,底下寫明原因
  await row.getByRole("button", { name: "所屬組織", exact: true }).click();
  const picker = dialogWithButton(page, "確定");
  const tenantTop = orgTreeCheckbox(picker, tenantOrgName);
  await expect(tenantTop).toBeChecked();
  await expect(tenantTop).toBeDisabled();
  await expect(
    picker.getByText(OWNER_LOCKED_HINT, { exact: true }),
  ).toBeVisible();
  await picker.getByRole("button", { name: "取消", exact: true }).click();
  await expect(picker).toBeHidden();

  // 角色管理 → 預設角色 →「分配使用者」:自己那一列掛「擁有者保護」、「移除」停用
  await page.goto(ROLE_MANAGER_ROUTE);
  await page
    .getByRole("list", { name: "角色清單" })
    .getByText(TENANT_ADMIN_ROLE_NAME, { exact: true })
    .click();
  await page.getByRole("tab", { name: "分配使用者" }).click();
  const holder = page
    .getByRole("table", { name: "角色持有人清單" })
    .getByRole("row")
    .filter({ has: page.getByText(tenantAdmin.account, { exact: true }) });
  await expect(
    holder.getByText(OWNER_PROTECTED_TAG, { exact: true }),
  ).toBeVisible();
  await expect(
    holder.getByRole("button", { name: "移除", exact: true }),
  ).toBeDisabled();

  // 步驟 1(api):三個動作硬送都回 OWNER_PROTECTED
  const token = tenantAdmin.token;
  expect(errorCodeOf(await setUserEnabledRaw(token, self, false))).toBe(
    "OWNER_PROTECTED",
  );
  expect(
    errorCodeOf(await setUserOrgsRaw(token, self, [tenant.nangangOrgId])),
  ).toBe("OWNER_PROTECTED");
  expect(errorCodeOf(await revokeRoleUsersRaw(token, copyRoleId, [self]))).toBe(
    "OWNER_PROTECTED",
  );

  // 三樣都沒動
  const after = await userById(tenant.rootToken, self);
  expect(after.enabled).toBe(true);
  expect(after.orgs.map((org) => org.id)).toContain(tenant.tenantOrgId);
  expect(after.roles.map((role) => role.id)).toContain(copyRoleId);
});

test("劇本 17:②租戶內任何人對租戶頂層停用 / 刪除 / 搬移 → 畫面按鈕停用,api 回 FORBIDDEN;對子組織照常做得到", async ({
  page,
  tenant,
}) => {
  const { tenantAdmin, member, tenantOrgId, tenantOrgName, nangangOrgId } =
    tenant;

  // 前置(api):+user 另拿一個擁有組織 = 租戶頂層、含 `system.org-manager.*` 的治理角色
  // —— 「租戶內任何人」不只擁有者,連權限齊全的其他人也一樣動不了頂層
  await grantMemberGovernanceRole(tenant, "租戶治理", tenantOrgId);

  // 畫面(+tenant):選租戶頂層 → 停用 / 刪除按鈕在但停用;編輯彈窗沒有「上層組織」下拉、改放租戶頂層提示
  await signIn(page, tenantAdmin.account, tenantAdmin.password);
  await page.goto(ORG_MANAGER_ROUTE);
  const dialog = await openEditOrgDialog(page, tenantOrgName);
  await expect(
    dialog.getByRole("combobox", { name: MOVE_TARGET_SELECT }),
  ).toHaveCount(0);
  await expect(dialog.getByText(TENANT_TOP_HINT)).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  const detail = orgDetail(page);
  await expect(
    detail.getByRole("button", { name: "停用", exact: true }),
  ).toBeDisabled();
  await expect(
    detail.getByRole("button", { name: "刪除", exact: true }),
  ).toBeDisabled();

  // 步驟 2(api):+tenant 與 +user 硬送三個動作都是 FORBIDDEN(排在 CYCLIC_MOVE 與刪除前置之前)
  for (const token of [tenantAdmin.token, member.token]) {
    expect(errorCodeOf(await setOrgEnabledRaw(token, tenantOrgId, false))).toBe(
      "FORBIDDEN",
    );
    expect(errorCodeOf(await deleteOrgRaw(token, tenantOrgId))).toBe(
      "FORBIDDEN",
    );
    expect(
      errorCodeOf(await moveOrgRaw(token, tenantOrgId, nangangOrgId)),
    ).toBe("FORBIDDEN");
  }

  // 對照:同一批權限對子組織做得到 —— FORBIDDEN 是頂層保護,不是缺權限。
  // 用 +tenant 做(他站在租戶頂層);+user 只屬南港店,停掉南港店會讓他自己的下一個請求進不來
  expect(
    errorCodeOf(await setOrgEnabledRaw(tenantAdmin.token, nangangOrgId, false)),
  ).toBeNull();
  expect(
    errorCodeOf(await setOrgEnabledRaw(tenantAdmin.token, nangangOrgId, true)),
  ).toBeNull();
});

test("劇本 17:③root 對擁有者做同一批動作 → 移出租戶頂層、解除預設角色、停用都做得到(根組織例外)", async ({
  tenant,
}) => {
  const { rootToken, tenantAdmin, nangangOrgId } = tenant;
  const owner = tenantAdmin.userId;
  const copyRoleId = await tenantAdminRoleId(tenant);
  // 移出前擁有者還有第二個所屬組織(南港店),否則撞到的是 LAST_ORG
  await expectOwnerHasSecondOrg(tenant);

  // 步驟 3(api):停用排最後 —— 停用會作廢擁有者的全部 refresh token
  expect(
    errorCodeOf(await setUserOrgsRaw(rootToken, owner, [nangangOrgId])),
  ).toBeNull();
  expect(
    errorCodeOf(await revokeRoleUsersRaw(rootToken, copyRoleId, [owner])),
  ).toBeNull();
  expect(
    errorCodeOf(await setUserEnabledRaw(rootToken, owner, false)),
  ).toBeNull();

  const after = await userById(rootToken, owner);
  expect(after.enabled).toBe(false);
  expect(after.orgs.map((org) => org.id)).toEqual([nangangOrgId]);
  expect(after.roles.map((role) => role.id)).not.toContain(copyRoleId);
});
