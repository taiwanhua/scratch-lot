import { type Locator, type Page, expect } from "@playwright/test";

import { MEMBER_PASSWORD } from "../config";
import {
  changePassword,
  createChildOrg,
  createRole,
  createUserWithPassword,
  flattenMatrix,
  formKeyOf,
  grantRoleUsers,
  login,
  roleMatrix,
  saveRoleMatrix,
} from "./api";
import { clickAndWaitForOperation } from "./scenario-forms";
import type { ScenarioTenant } from "./scenario-tenant";
import { signInAgain } from "./ui";
import { publishSharedFormIn, setOrgManagers } from "./workflow-api";

/**
 * 劇本 20–24(審核流程)的共用前置與畫面動作。前置一律走 api(TEST-11):
 * 建人、主管、角色、共用表單(掛在 seed 的「示範表單(群組內)」模組,路由 `/demo/form`)都在這裡;流程定義由各劇本自己給。
 */

export const WORKFLOW_FORM_MODULE = "demo.form";
export const WORKFLOW_FORM_ROUTE = "/demo/form";
export const APPLY_CENTER_ROUTE = "/apply-center";
export const BLOCKED_ROUTE = "/system/workflows/blocked-page";

export interface WorkflowPerson {
  account: string;
  password: string;
  name: string;
  token: string;
  userId: string;
}

/** 建一個本租戶的使用者(初始密碼啟用、清掉首登強改),回登入 token。 */
export async function createPerson(
  tenant: ScenarioTenant,
  key: string,
  name: string,
  orgIds: readonly string[],
): Promise<WorkflowPerson> {
  const account = `${key}-${tenant.slug}`;
  const userId = await createUserWithPassword(tenant.tenantAdmin.token, {
    account,
    name,
    email: `${account}@cookhome.test`,
    orgIds,
    initialPassword: MEMBER_PASSWORD,
  });
  const firstToken = await login(account, MEMBER_PASSWORD);
  await changePassword(firstToken, MEMBER_PASSWORD, MEMBER_PASSWORD);
  const token = await login(account, MEMBER_PASSWORD);
  return { account, password: MEMBER_PASSWORD, name, token, userId };
}

/** 建角色並勾上某幾個模組(含隱藏頁)與它們的全部權限,再指派給這些人。 */
async function roleWithModules(
  tenant: ScenarioTenant,
  name: string,
  modulePrefixes: readonly string[],
  userIds: readonly string[],
): Promise<string> {
  const token = tenant.tenantAdmin.token;
  const roleId = await createRole(token, name, tenant.tenantOrgId);
  if (modulePrefixes.length > 0) {
    const { modules } = await roleMatrix(token, roleId);
    const picked = flattenMatrix(modules).filter((module) =>
      modulePrefixes.some(
        (prefix) =>
          module.key === prefix || module.key.startsWith(`${prefix}.`),
      ),
    );
    await saveRoleMatrix(token, {
      roleId,
      moduleKeys: picked.map((module) => module.key),
      permissionKeys: picked.flatMap((module) =>
        module.permissions.map((permission) => permission.key),
      ),
    });
  }
  if (userIds.length > 0) {
    await grantRoleUsers(token, roleId, userIds);
  }
  return roleId;
}

export interface WorkflowWorld {
  tenant: ScenarioTenant;
  /** 南港店底下的「南港廚房」:申請人所屬組織(往上一層的南港店才有主管) */
  kitchenOrgId: string;
  applicant: WorkflowPerson;
  /** 南港店的主管(`org_manager`) */
  manager: WorkflowPerson;
  hr: WorkflowPerson;
  deputy: WorkflowPerson;
  /** 劇本自己要的其他審核者(key → 人) */
  extra: Record<string, WorkflowPerson>;
  hrRoleId: string;
  formKey: string;
}

/** 一個使用者填的欄位(表單定義的最小形狀)。 */
function inputField(key: string, label: string, required: boolean) {
  return {
    key,
    label,
    type: "text",
    widget: { kind: "textField" },
    valueSource: { kind: "input" },
    options: null,
    rules: { required },
    permission: { show: false, edit: false },
    help: null,
  };
}

/** 表單定義:標題(摘要標題)+ 天數 / 金額。 */
function formDefinition(numberLabel: string) {
  return {
    fields: [
      inputField("title", "標題", true),
      {
        ...inputField("amount", numberLabel, false),
        type: "number",
        widget: { kind: "number" },
        precision: 0,
      },
    ],
    layout: {
      sections: [
        {
          key: "basic",
          title: "內容",
          rows: [
            {
              cols: [
                { fieldKey: "title", span: 8 },
                { fieldKey: "amount", span: 4 },
              ],
            },
          ],
        },
      ],
    },
    summaryMap: { title: "title" },
    prefills: [],
  };
}

/**
 * 審核流程劇本的世界:申請人(南港廚房)、南港店主管、人資(「人資」角色)、副理;
 * root 建一張共用表單掛在「示範表單(群組內)」模組、發布、分派給這個租戶。流程由劇本自己建與綁。
 */
export async function createWorkflowWorld(
  tenant: ScenarioTenant,
  options: {
    formName: string;
    numberLabel?: string;
    extra?: Record<string, string>;
  },
): Promise<WorkflowWorld> {
  const admin = tenant.tenantAdmin.token;
  const kitchenOrgId = await createChildOrg(
    admin,
    tenant.nangangOrgId,
    "南港廚房",
  );
  const applicant = await createPerson(tenant, "app", "申請人小明", [
    kitchenOrgId,
  ]);
  const manager = await createPerson(tenant, "mgr", "南港主管", [
    tenant.nangangOrgId,
  ]);
  await setOrgManagers(admin, tenant.nangangOrgId, [manager.userId]);
  const hr = await createPerson(tenant, "hr", "人資阿美", [tenant.tenantOrgId]);
  const deputy = await createPerson(tenant, "dep", "副理阿強", [
    tenant.tenantOrgId,
  ]);
  const extra: Record<string, WorkflowPerson> = {};
  for (const [key, name] of Object.entries(options.extra ?? {})) {
    extra[key] = await createPerson(tenant, key, name, [tenant.tenantOrgId]);
  }

  await roleWithModules(
    tenant,
    "申請人",
    [WORKFLOW_FORM_MODULE, "apply-center"],
    [applicant.userId],
  );
  await roleWithModules(
    tenant,
    "審核員",
    ["apply-center"],
    [manager, hr, deputy, ...Object.values(extra)].map(
      (person) => person.userId,
    ),
  );
  const hrRoleId = await roleWithModules(tenant, "人資", [], [hr.userId]);

  const formKey = formKeyOf("wf", tenant.slug);
  await publishSharedFormIn(tenant.rootToken, {
    key: formKey,
    name: options.formName,
    moduleKey: WORKFLOW_FORM_MODULE,
    definition: formDefinition(options.numberLabel ?? "天數"),
    tenantOrgIds: [tenant.tenantOrgId],
  });

  return {
    tenant,
    kitchenOrgId,
    applicant,
    manager,
    hr,
    deputy,
    extra,
    hrRoleId,
    formKey,
  };
}

/** 劇本自己要的那幾位審核者(`options.extra` 建的);沒建到就拋(前置失敗要當場炸)。 */
export function extraPerson(world: WorkflowWorld, key: string): WorkflowPerson {
  const person = world.extra[key];
  if (person === undefined) {
    throw new Error(`前置沒有建 ${key}`);
  }
  return person;
}

/* ---- 流程定義 ---- */

export function reviewStep(
  key: string,
  name: string,
  assignee: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key,
    name,
    kind: "review",
    assignee,
    mode: "any",
    skipWhen: null,
    allowReturn: true,
    ...overrides,
  };
}

/** 審核者來源「人員條件」:條件列全部 AND。 */
function audienceOf(
  ...rows: Record<string, unknown>[]
): Record<string, unknown> {
  return {
    kind: "audience",
    audience: { mode: "match", filter: { op: "AND", children: rows } },
  };
}

/** 指定這幾個人(人員條件的使用者條件列)。 */
export function usersOf(...people: WorkflowPerson[]): Record<string, unknown> {
  return audienceOf({
    field: "user",
    cond: "in",
    value: { kind: "static", values: people.map((person) => person.userId) },
  });
}

/** 持有這個角色的人(人員條件的角色條件列)。 */
export function roleOf(roleId: string): Record<string, unknown> {
  return audienceOf({
    field: "role",
    cond: "in",
    value: { kind: "static", values: [roleId] },
  });
}

/* ---- 畫面 ---- */

/** 登入後進申請中心「待我審核」,打開某張單(列上的「審核」鈕,無障礙名稱「開啟「標題」」)。 */
export async function openTaskInApplyCenter(
  page: Page,
  person: WorkflowPerson,
  title: string,
): Promise<void> {
  await signInAgain(page, person.account, person.password);
  await page.goto(APPLY_CENTER_ROUTE);
  await page.getByRole("tab", { name: "待我審核" }).click();
  await page.getByRole("button", { name: `開啟「${title}」` }).click();
  await page.waitForURL((url) =>
    url.pathname.startsWith(`${APPLY_CENTER_ROUTE}/view-page/`),
  );
}

/** 登入後直接開申請中心詳情頁(申請人看自己的單、通知信連結的形狀)。 */
export async function openInstanceDetail(
  page: Page,
  person: WorkflowPerson,
  instanceId: string,
): Promise<void> {
  await signInAgain(page, person.account, person.password);
  await page.goto(`${APPLY_CENTER_ROUTE}/view-page/${instanceId}`);
  await expect(stepProgress(page)).toBeVisible();
}

/** 審核區塊的關卡進度(`<ol aria-label="關卡進度">`)。 */
export function stepProgress(page: Page): Locator {
  return page.getByRole("list", { name: "關卡進度" });
}

/** 關卡進度的一列(`<li aria-label="<關卡>:<狀態>">`)。 */
export function progressRow(page: Page, step: string, state: string): Locator {
  return stepProgress(page).getByRole("listitem", { name: `${step}:${state}` });
}

/**
 * 在審核區塊做決定:按「核准 / 駁回 / 退回修改」→ 跳窗(駁回與退回的理由必填)→ 確認,等 `DecideTask` 回來。
 */
export async function decideInUi(
  page: Page,
  decision: "核准" | "駁回" | "退回修改",
  reason: string | null = null,
): Promise<void> {
  await page.getByRole("button", { name: decision, exact: true }).click();
  const dialog = page.getByRole("dialog");
  if (reason !== null) {
    await dialog.getByRole("textbox", { name: "理由" }).fill(reason);
  }
  await clickAndWaitForOperation(
    page,
    dialog.getByRole("button", { name: decision, exact: true }),
    "DecideTask",
  );
  await expect(dialog).toBeHidden();
}

/** 流程管理者在阻擋清單把某張單卡住的任務改派給另一個人。 */
export async function reassignInBlockedList(
  page: Page,
  tenant: ScenarioTenant,
  title: string,
  to: WorkflowPerson,
): Promise<void> {
  await signInAgain(
    page,
    tenant.tenantAdmin.account,
    tenant.tenantAdmin.password,
  );
  await page.goto(BLOCKED_ROUTE);
  const row = page
    .getByRole("table", { name: "阻擋清單" })
    .getByRole("row")
    .filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "改派" }).click();
  const dialog = page.getByRole("dialog");
  const picker = dialog.getByRole("combobox", { name: "審核者" });
  await picker.click();
  await picker.fill(to.name);
  await page.getByRole("option", { name: new RegExp(to.name) }).click();
  await clickAndWaitForOperation(
    page,
    dialog.getByRole("button", { name: "確定" }),
    "ReassignTask",
  );
  await expect(dialog).toBeHidden();
}

/** 申請人「我的申請」裡某張單那一列。 */
export async function myApplicationRow(
  page: Page,
  person: WorkflowPerson,
  title: string,
): Promise<Locator> {
  await signInAgain(page, person.account, person.password);
  await page.goto(APPLY_CENTER_ROUTE);
  return page
    .getByRole("table", { name: "我的申請" })
    .getByRole("row")
    .filter({ hasText: title });
}
