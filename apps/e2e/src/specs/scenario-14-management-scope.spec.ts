import type { Page } from "@playwright/test";

import {
  createDemoItemOne,
  grantRoleUsers,
  moveOrgRaw,
  orgRaw,
  orgTree,
  orgTreeRaw,
  revokeRoleUsers,
  setOrgVisibility,
  setOrgVisibilityRaw,
  setRoleEnabled,
} from "../fixtures/api";
import {
  ORG_MANAGER_ROUTE,
  ROLE_MANAGER_ROUTE,
  SAMPLE_ONE_LIST_ROUTE,
  USER_MANAGER_ROUTE,
} from "../fixtures/demo-keys";
import { errorCodeOf } from "../fixtures/graphql";
import {
  ORG_MANAGER_EDIT,
  ORG_MANAGER_VIEW,
  ORG_VIEW_ONLY,
  WAREHOUSE,
  createNangangWarehouse,
  dropSupportRole,
  grantMemberGovernanceRole,
  provisionOtherTenant,
  setGovernanceMatrix,
} from "../fixtures/scenario-management-scope";
import { addMemberToNeihu } from "../fixtures/scenario-org-membership";
import { expect, test } from "../fixtures/test";
import {
  MOVE_TARGET_SELECT,
  TENANT_TOP_HINT,
  VISIBILITY_SWITCH,
  expectDemoItems,
  expectForbiddenPage,
  openEditOrgDialog,
  orgTreeRootLabels,
  orgTree as orgTreeView,
  readGovernancePages,
  readMoveTargets,
  signIn,
  signInAgain,
  toggleOrgVisibility,
  userRow,
} from "../fixtures/ui";

/**
 * 劇本 14 — 管理範圍 vs 可見範圍
 * 正本:`docs/testing/permission-scenarios.md` 第 14 條的六個小節 +「劇本 14」的落點表;
 * 詞條見 CONTEXT.md「管理範圍」「可見範圍」、分工表見 ADR-0005。
 * 帳號:+tenant 建角色與指派(走 api)、被測的是 +user;「可見性開關的權限搬家」與「搬移候選」
 * 另用 +tenant 本人操作畫面。
 *
 * **與劇本 12 的差別**:12 驗的是開關讓**業務資料**收縮、治理頁不動(從 +tenant 的視角);
 * 本劇本驗的是治理頁**本身怎麼決定範圍** —— 由持有的角色(擁有組織)決定,與所屬哪裡、開關都無關。
 *
 * **前置與文件字面不同的一處**(見 PR「規則回饋」):管理範圍算的是**全部**啟用中角色的擁有組織,
 * 不只治理角色。「客服」的擁有組織是租戶頂層,只要它還在 +user 身上,樹根永遠是租戶頂層 ——
 * 所以要看樹根的小節先把客服拿掉;治理角色的矩陣另含客服那一份示範家族,+user 照樣進得了示範模組1。
 */

const TOP_ROLE = "租戶治理";
const NANGANG_ROLE = "南港店治理";
const NEIHU_ROLE = "內湖店治理";
const VIEW_ROLE = "組織檢視";
const NANGANG = "南港店";
const NEIHU = "內湖店";
const VISIBILITY_SAVED = "已儲存組織資料。";

/** 到組織管理頁、等樹上 `anchor` 出現,回傳樹根的標籤。 */
async function openOrgTreeRoots(page: Page, anchor: string): Promise<string[]> {
  await page.goto(ORG_MANAGER_ROUTE);
  await expect(
    orgTreeView(page).getByText(anchor, { exact: true }),
  ).toBeVisible();
  return orgTreeRootLabels(page);
}

test("劇本 14:①由角色決定 —— 擁有組織 = 租戶頂層 → 樹根是租戶頂層;換成南港店 → 樹根變南港店、其他分店不回傳", async ({
  page,
  tenant,
}) => {
  const { member, tenantAdmin, tenantOrgId, tenantOrgName } = tenant;

  // 前置(api):+user 只屬南港店;給他擁有組織 = 租戶頂層的治理角色,客服拿掉
  const topRoleId = await grantMemberGovernanceRole(
    tenant,
    TOP_ROLE,
    tenantOrgId,
  );
  await dropSupportRole(tenant);

  // 樹根是租戶頂層,整個租戶的組織都在樹上
  await signIn(page, member.account, member.password);
  expect(await openOrgTreeRoots(page, NEIHU)).toEqual([tenantOrgName]);
  await expect(
    orgTreeView(page).getByText(NANGANG, { exact: true }),
  ).toBeVisible();
  // 使用者也管得到整個租戶:只屬租戶頂層 + 南港店的 +tenant 列在清單上
  await page.goto(USER_MANAGER_ROUTE);
  await expect(userRow(page, tenantAdmin.account)).toBeVisible();

  // 換角色:擁有組織 = 南港店的那一個
  await grantMemberGovernanceRole(tenant, NANGANG_ROLE, tenant.nangangOrgId);
  await revokeRoleUsers(tenantAdmin.token, topRoleId, [member.userId]);

  // 樹根變成南港店;租戶頂層與內湖店**不出現**(不是灰的,是不回傳)
  expect(await openOrgTreeRoots(page, NANGANG)).toEqual([NANGANG]);
  const tree = orgTreeView(page);
  await expect(tree.getByText(NEIHU, { exact: true })).toHaveCount(0);
  await expect(tree.getByText(tenantOrgName, { exact: true })).toHaveCount(0);

  // api:樹只有南港店一個根;`org(內湖店)` 與 `org(租戶頂層)` 都是 NOT_FOUND
  const roots = await orgTree(member.token);
  expect(roots.map((root) => [root.name, root.parentId])).toEqual([
    [NANGANG, null],
  ]);
  expect(errorCodeOf(await orgRaw(member.token, tenant.neihuOrgId))).toBe(
    "NOT_FOUND",
  );
  expect(errorCodeOf(await orgRaw(member.token, tenantOrgId))).toBe(
    "NOT_FOUND",
  );
  expect(
    errorCodeOf(await orgRaw(member.token, tenant.nangangOrgId)),
  ).toBeNull();
});

test("劇本 14:②不受可見性開關影響 —— 切成 OWN 後治理頁、角色清單、搬移候選完全不變,示範模組1 列表收縮", async ({
  page,
  tenant,
}) => {
  const { member, tenantAdmin, tenantOrgId } = tenant;

  // 前置(api):南港倉庫 + 那裡的一筆;+user 在南港店自建一筆;治理角色擁有組織 = 南港店,客服拿掉
  const warehouse = await createNangangWarehouse(tenant);
  const ownItem = `南港-自建-${tenant.slug}`;
  await createDemoItemOne(member.token, { name: ownItem });
  await grantMemberGovernanceRole(tenant, NANGANG_ROLE, tenant.nangangOrgId);
  await dropSupportRole(tenant);
  // 開關先設 ON(新開通的租戶沒設定 = OWN)
  await setOrgVisibility(tenantAdmin.token, tenantOrgId, "SUBTREE");

  const anchors = {
    orgName: WAREHOUSE,
    account: member.account,
    roleName: NANGANG_ROLE,
  };
  const routes = {
    org: ORG_MANAGER_ROUTE,
    user: USER_MANAGER_ROUTE,
    role: ROLE_MANAGER_ROUTE,
  };
  const readScope = async () => {
    const pages = await readGovernancePages(page, anchors, routes);
    const roots = await openOrgTreeRoots(page, WAREHOUSE);
    const dialog = await openEditOrgDialog(page, WAREHOUSE);
    const moveTargets = await readMoveTargets(page, dialog);
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toBeHidden();
    return { ...pages, roots, moveTargets };
  };

  // ON:業務資料含下層(南港倉庫那一筆);治理頁是南港店這棵
  await signIn(page, member.account, member.password);
  await page.goto(SAMPLE_ONE_LIST_ROUTE);
  await expectDemoItems(page, {
    total: 2,
    visible: [ownItem, warehouse.itemName],
  });
  const before = await readScope();
  expect(before.roots).toEqual([NANGANG]);
  expect(before.moveTargets).toEqual([NANGANG]);
  const treeBefore = await orgTree(member.token);

  // 開關切成 OWN(api;畫面上的切換由劇本 12 與本劇本 ⑤ 驗)
  await setOrgVisibility(tenantAdmin.token, tenantOrgId, "OWN");

  // 業務資料收縮成只剩自己所屬組織(南港店)的那一筆
  await page.goto(SAMPLE_ONE_LIST_ROUTE);
  await expectDemoItems(page, {
    total: 1,
    visible: [ownItem],
    hidden: [warehouse.itemName],
  });
  // 治理頁三處、樹根、搬移候選完全不變(管理範圍不看開關)
  expect(await readScope()).toEqual(before);
  expect(await orgTree(member.token)).toEqual(treeBefore);
});

test("劇本 14:③多根 —— 南港店與內湖店兩個角色 → 兩個樹根;停用其中一個 → 那棵整個退出", async ({
  page,
  tenant,
}) => {
  const { member, tenantAdmin } = tenant;

  // 前置(api):擁有組織 = 南港店 / = 內湖店的兩個治理角色(兩者沒有共同上層在範圍內),客服拿掉。
  // 授予要過資格檢查(所屬組織要落在角色擁有組織的子樹內,否則 `USER_NOT_ELIGIBLE`),
  // 所以 +user 先加入內湖店 —— 文件只寫「同時授予」,沒寫這一步(見 PR「規則回饋」)
  await addMemberToNeihu(tenant);
  await grantMemberGovernanceRole(tenant, NANGANG_ROLE, tenant.nangangOrgId);
  const neihuRoleId = await grantMemberGovernanceRole(
    tenant,
    NEIHU_ROLE,
    tenant.neihuOrgId,
  );
  await dropSupportRole(tenant);

  // 兩個根
  await signIn(page, member.account, member.password);
  const roots = await openOrgTreeRoots(page, NEIHU);
  // 兩個根的先後不是本劇本要驗的(沒有規定排序),只比集合
  expect(roots).toHaveLength(2);
  expect(roots).toEqual(expect.arrayContaining([NANGANG, NEIHU]));
  await expect(
    orgTreeView(page).getByText(tenant.tenantOrgName, { exact: true }),
  ).toHaveCount(0);

  // +tenant 停用「內湖店治理」→ 內湖店那一棵整個退出管理範圍
  await setRoleEnabled(tenantAdmin.token, neihuRoleId, false);
  expect(await openOrgTreeRoots(page, NANGANG)).toEqual([NANGANG]);
  await expect(orgTreeView(page).getByText(NEIHU, { exact: true })).toHaveCount(
    0,
  );
  expect(errorCodeOf(await orgRaw(member.token, tenant.neihuOrgId))).toBe(
    "NOT_FOUND",
  );
});

test("劇本 14:④無治理角色 = 空 —— 解除或停用全部治理角色 → 治理頁無權限、api FORBIDDEN", async ({
  page,
  tenant,
}) => {
  const { member, tenantAdmin, tenantOrgId, tenantOrgName } = tenant;

  // 前置(api):擁有組織 = 租戶頂層的治理角色;客服留著(登入後要有地方落腳,它沒有任何治理權限)
  const topRoleId = await grantMemberGovernanceRole(
    tenant,
    TOP_ROLE,
    tenantOrgId,
  );

  // 對照組:有治理角色時組織管理頁進得去
  await signIn(page, member.account, member.password);
  expect(await openOrgTreeRoots(page, NEIHU)).toEqual([tenantOrgName]);

  const expectNoGovernance = async () => {
    for (const route of [
      ORG_MANAGER_ROUTE,
      USER_MANAGER_ROUTE,
      ROLE_MANAGER_ROUTE,
    ]) {
      await page.goto(route);
      await expectForbiddenPage(page);
    }
    expect(errorCodeOf(await orgTreeRaw(member.token))).toBe("FORBIDDEN");
    expect(errorCodeOf(await orgRaw(member.token, tenant.nangangOrgId))).toBe(
      "FORBIDDEN",
    );
  };

  // 解除治理角色 → 三個治理頁手打網址都是無權限頁;硬送 orgTree / org → FORBIDDEN
  await revokeRoleUsers(tenantAdmin.token, topRoleId, [member.userId]);
  await expectNoGovernance();

  // 改成「授予還在、但角色停用」→ 同樣的結果(停用的角色不給權限、也不算進管理範圍)
  await grantRoleUsers(tenantAdmin.token, topRoleId, [member.userId]);
  await setRoleEnabled(tenantAdmin.token, topRoleId, false);
  await expectNoGovernance();

  // 連客服也解除(全部角色都沒了)→ 所屬組織(南港店)不給任何管理範圍,api 照樣 FORBIDDEN
  await dropSupportRole(tenant);
  expect(errorCodeOf(await orgTreeRaw(member.token))).toBe("FORBIDDEN");
});

test("劇本 14:⑤可見性開關的權限搬家 —— +tenant 設得了自己的租戶頂層;別的租戶 NOT_FOUND、非頂層 VALIDATION_FAILED、只有 view 的人看不到也送不了", async ({
  page,
  tenant,
}) => {
  const { member, tenantAdmin, tenantOrgId, tenantOrgName } = tenant;
  const otherTenantTopId = await provisionOtherTenant(tenant);

  // +tenant 編輯自己的租戶頂層:看得到開關,切 OFF → ON 存得了
  await signIn(page, tenantAdmin.account, tenantAdmin.password);
  await page.goto(ORG_MANAGER_ROUTE);
  await toggleOrgVisibility(page, tenantOrgName, { isOn: false });
  await expect(page.getByText(VISIBILITY_SAVED)).toBeVisible();
  const saved = await orgRaw(tenantAdmin.token, tenantOrgId);
  expect(saved.data?.org.visibility).toBe("SUBTREE");

  // 開關只在租戶頂層:編輯南港店的彈窗沒有它
  const nangangDialog = await openEditOrgDialog(page, NANGANG);
  await expect(
    nangangDialog.getByRole("combobox", { name: MOVE_TARGET_SELECT }),
  ).toBeVisible();
  await expect(nangangDialog.getByRole("switch")).toHaveCount(0);
  await nangangDialog.getByRole("button", { name: "取消" }).click();
  await expect(nangangDialog).toBeHidden();

  // api:別的租戶的頂層 → NOT_FOUND(管理範圍外);非租戶頂層 → VALIDATION_FAILED
  expect(
    errorCodeOf(
      await setOrgVisibilityRaw(tenantAdmin.token, otherTenantTopId, "SUBTREE"),
    ),
  ).toBe("NOT_FOUND");
  expect(
    errorCodeOf(
      await setOrgVisibilityRaw(
        tenantAdmin.token,
        tenant.nangangOrgId,
        "SUBTREE",
      ),
    ),
  ).toBe("VALIDATION_FAILED");

  // 只持 `system.org-manager.view` 的 +user(擁有組織 = 租戶頂層):沒有「編輯」,開關無從出現
  const viewRoleId = await grantMemberGovernanceRole(
    tenant,
    VIEW_ROLE,
    tenantOrgId,
    ORG_VIEW_ONLY,
  );
  await signInAgain(page, member.account, member.password);
  await page.goto(ORG_MANAGER_ROUTE);
  await orgTreeView(page).getByText(tenantOrgName, { exact: true }).click();
  const detail = page.getByRole("region", { name: "組織資料" });
  await expect(detail.getByText(tenantOrgName, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "編輯", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("switch", { name: VISIBILITY_SWITCH }),
  ).toHaveCount(0);
  expect(
    errorCodeOf(await setOrgVisibilityRaw(member.token, tenantOrgId, "OWN")),
  ).toBe("FORBIDDEN");

  // 加上 `edit`(仍沒有 `set-visibility`):編輯彈窗打得開,但裡面沒有開關,硬送照樣 FORBIDDEN
  await setGovernanceMatrix(tenant, viewRoleId, {
    moduleKeys: ORG_VIEW_ONLY.moduleKeys,
    permissionKeys: [ORG_MANAGER_VIEW, ORG_MANAGER_EDIT],
  });
  await page.goto(ORG_MANAGER_ROUTE);
  const topDialog = await openEditOrgDialog(page, tenantOrgName);
  await expect(topDialog.getByRole("textbox").first()).toBeVisible();
  await expect(topDialog.getByRole("switch")).toHaveCount(0);
  expect(
    errorCodeOf(await setOrgVisibilityRaw(member.token, tenantOrgId, "OWN")),
  ).toBe("FORBIDDEN");
  // 被拒的兩次都沒有寫進去
  const after = await orgRaw(tenantAdmin.token, tenantOrgId);
  expect(after.data?.org.visibility).toBe("SUBTREE");
});

test("劇本 14:⑥搬移候選 = 管理範圍 ∩ 同租戶 − 自己子樹;跨租戶 NOT_FOUND、搬進子樹 CYCLIC_MOVE、租戶內搬頂層 FORBIDDEN", async ({
  page,
  tenant,
}) => {
  const { member, tenantAdmin, tenantOrgId, tenantOrgName } = tenant;
  const warehouse = await createNangangWarehouse(tenant);
  const otherTenantTopId = await provisionOtherTenant(tenant);

  // +tenant(管理範圍 = 整個租戶):南港店的候選 = 租戶頂層與內湖店;南港店自己與南港倉庫(子樹)不在
  await signIn(page, tenantAdmin.account, tenantAdmin.password);
  await page.goto(ORG_MANAGER_ROUTE);
  const nangangDialog = await openEditOrgDialog(page, NANGANG);
  const nangangTargets = await readMoveTargets(page, nangangDialog);
  expect(nangangTargets).toHaveLength(2);
  expect(nangangTargets).toEqual(
    expect.arrayContaining([tenantOrgName, `${tenantOrgName} / ${NEIHU}`]),
  );
  await nangangDialog.getByRole("button", { name: "取消" }).click();
  await expect(nangangDialog).toBeHidden();

  // 租戶頂層:沒有「上層組織」下拉,那個位置改放租戶頂層提示(租戶內的人不可搬頂層,ADR-0009;
  // 現況見 docs/modules/org-manager.md「根組織與租戶頂層的編輯彈窗不顯示「上層組織」下拉」)
  const topDialog = await openEditOrgDialog(page, tenantOrgName);
  await expect(
    topDialog.getByRole("combobox", { name: MOVE_TARGET_SELECT }),
  ).toHaveCount(0);
  await expect(topDialog.getByText(TENANT_TOP_HINT)).toBeVisible();
  await topDialog.getByRole("button", { name: "取消" }).click();
  await expect(topDialog).toBeHidden();

  // +user(治理角色擁有組織 = 南港店):南港倉庫的候選只剩南港店 —— 租戶頂層、內湖店在管理範圍外
  await grantMemberGovernanceRole(tenant, NANGANG_ROLE, tenant.nangangOrgId);
  await dropSupportRole(tenant);
  await signInAgain(page, member.account, member.password);
  await page.goto(ORG_MANAGER_ROUTE);
  const warehouseDialog = await openEditOrgDialog(page, WAREHOUSE);
  expect(await readMoveTargets(page, warehouseDialog)).toEqual([NANGANG]);

  // api 再驗一次(+tenant):
  // 搬去別的租戶 → 範圍外即 NOT_FOUND;搬進自己的子樹 → CYCLIC_MOVE;搬租戶頂層本身 → FORBIDDEN
  expect(
    errorCodeOf(
      await moveOrgRaw(tenantAdmin.token, tenant.neihuOrgId, otherTenantTopId),
    ),
  ).toBe("NOT_FOUND");
  expect(
    errorCodeOf(
      await moveOrgRaw(tenantAdmin.token, tenant.nangangOrgId, warehouse.orgId),
    ),
  ).toBe("CYCLIC_MOVE");
  expect(
    errorCodeOf(
      await moveOrgRaw(tenantAdmin.token, tenantOrgId, tenant.neihuOrgId),
    ),
  ).toBe("FORBIDDEN");
  // 對照:root 看得到兩邊,同一個跨租戶搬移拿到的才是 CROSS_TENANT
  expect(
    errorCodeOf(
      await moveOrgRaw(tenant.rootToken, tenant.neihuOrgId, otherTenantTopId),
    ),
  ).toBe("CROSS_TENANT");
  // +user 把南港倉庫搬去內湖店(候選外)→ 內湖店在他的管理範圍外,NOT_FOUND
  expect(
    errorCodeOf(
      await moveOrgRaw(member.token, warehouse.orgId, tenant.neihuOrgId),
    ),
  ).toBe("NOT_FOUND");

  // 被拒的搬移一個都沒生效
  const neihu = await orgRaw(tenantAdmin.token, tenant.neihuOrgId);
  expect(neihu.data?.org.parentId).toBe(tenantOrgId);
  const nangang = await orgRaw(tenantAdmin.token, tenant.nangangOrgId);
  expect(nangang.data?.org.parentId).toBe(tenantOrgId);
});
