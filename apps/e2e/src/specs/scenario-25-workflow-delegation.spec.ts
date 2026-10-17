import { type Page } from "@playwright/test";

import { clickAndWaitForOperation } from "../fixtures/scenario-forms";
import {
  APPLY_CENTER_ROUTE,
  PERSONAL_SETTINGS_ROUTE,
  type WorkflowPerson,
  createWorkflowWorld,
  decideInUi,
  extraPerson,
  openTaskInApplyCenter,
  progressRow,
  reviewStep,
  stepProgress,
  timelineEntry,
  todayIn,
  typeDate,
  usersOf,
} from "../fixtures/scenario-workflows";
import { expect, test } from "../fixtures/test";
import { signInAgain } from "../fixtures/ui";
import {
  createMyDelegation,
  myTasks,
  publishCustomWorkflow,
  submissionStatus,
  submitForm,
  taskSubmissionIds,
  workflowInstance,
} from "../fixtures/workflow-api";

/** 個人設定 →「代理人」分頁。 */
async function openDelegationsTab(
  page: Page,
  person: WorkflowPerson,
): Promise<void> {
  await signInAgain(page, person.account, person.password);
  await page.goto(PERSONAL_SETTINGS_ROUTE);
  await page.getByRole("tab", { name: "代理人" }).click();
}

/** 某個時區現在是當天的第幾分鐘(0–1439)。 */
function minutesOfDayIn(timezone = "Asia/Taipei"): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const valueOf = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return valueOf("hour") * 60 + valueOf("minute");
}

/** 「我的代理」表格裡代理人是某人的那一列。 */
function delegationRow(page: Page, delegate: WorkflowPerson) {
  return page
    .getByRole("table", { name: "我的代理" })
    .getByRole("row")
    .filter({ hasText: delegate.name });
}

/**
 * 劇本 25 — 代理人
 * 正本:`docs/testing/permission-scenarios.md`「劇本 25」;規則見《底座規格》3.7 B15。
 * 用哪一頁:個人設定 →「代理人」分頁(店長甲)、申請中心「待我審核」→ 詳情頁審核區塊(代理人丙)。
 * 前置(走 api):客製流程「店長審核(店長甲)→ 店長會簽(店長甲、店長乙,全部核准)」並綁定;
 * 店長乙以 api 設好「代理人丙、今天」的代理(會簽那半段要兩位都委託同一人)。
 */
test("劇本 25:代理期間的任務改派給代理人;會簽多人委託同一人只出一張待辦、一票算完;刪除代理後不再改派", async ({
  page,
  tenant,
}) => {
  // 代理期間是「今天到今天」(最上層組織時區 00:00 起、24:00 止):台北 23:50 之後開跑,
  // 劇本中途就可能跨過午夜、代理已結束,任務不再改派而紅 —— 那 10 分鐘直接 skip,不是缺陷
  test.skip(
    minutesOfDayIn() >= 23 * 60 + 50,
    "台北 23:50 之後開跑會跨日,「今天」的代理在劇本中途結束",
  );
  test.setTimeout(300_000);
  const world = await createWorkflowWorld(tenant, {
    formName: "請款單",
    numberLabel: "金額",
    extra: { sa: "店長甲", sb: "店長乙", dg: "代理人丙" },
  });
  const storeA = extraPerson(world, "sa");
  const storeB = extraPerson(world, "sb");
  const delegate = extraPerson(world, "dg");
  await publishCustomWorkflow(tenant.tenantAdmin.token, {
    key: `claim_${tenant.slug}`,
    name: "請款審核",
    definition: {
      steps: [
        reviewStep("store", "店長審核", usersOf(storeA)),
        reviewStep("joint", "店長會簽", usersOf(storeA, storeB), {
          mode: "all",
        }),
      ],
      edges: null,
    },
    bindFormKey: world.formKey,
  });
  const today = todayIn();

  // 步驟 1:店長甲 → 個人設定「代理人」→「+ 新增代理」:代理人丙、今天到今天
  await openDelegationsTab(page, storeA);
  await page.getByRole("button", { name: "+ 新增代理" }).click();
  const dialog = page.getByRole("dialog", { name: "新增代理" });
  const picker = dialog.getByRole("combobox", { name: "代理人" });
  await picker.click();
  await picker.fill(delegate.name);
  await page.getByRole("option", { name: new RegExp(delegate.name) }).click();
  await typeDate(dialog, "開始", today);
  await typeDate(dialog, "結束", today);
  await clickAndWaitForOperation(
    page,
    dialog.getByRole("button", { name: "新增", exact: true }),
    "CreateMyDelegation",
  );
  await expect(dialog).toBeHidden();
  await expect(delegationRow(page, delegate)).toContainText("代理中");

  // 前置:店長乙也委託代理人丙(api)
  const now = new Date();
  await createMyDelegation(storeB.token, {
    delegateUserId: delegate.userId,
    startAt: new Date(now.getTime() - 60_000),
    endAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  });

  const title = `請款兩千-${tenant.slug}`;
  const submitted = await submitForm(world.applicant.token, world.formKey, {
    title,
    amount: 2000,
  });
  const instanceId = submitted.currentInstanceId ?? "";

  // 預期:店長審核派給代理人丙,不是店長甲
  expect(await myTasks(storeA.token)).toHaveLength(0);
  expect(await taskSubmissionIds(delegate.token)).toEqual([submitted.id]);

  // 步驟 2:代理人丙 → 待我審核看得到 → 打開:關卡進度寫「代理人丙(代理 店長甲)」→ 核准
  await openTaskInApplyCenter(page, delegate, title);
  await expect(progressRow(page, "店長審核", "審核中")).toContainText(
    `${delegate.name}(代理 ${storeA.name})`,
  );
  await expect(
    timelineEntry(page, `「店長審核」由 ${delegate.name} 代理 ${storeA.name}`),
  ).toHaveCount(1);
  await decideInUi(page, "核准");
  await expect(progressRow(page, "店長審核", "已通過")).toBeVisible();
  await expect(
    timelineEntry(
      page,
      `「店長審核」由 ${delegate.name} 代理 ${storeA.name} 核准`,
    ),
  ).toBeVisible();

  // 預期:會簽兩位都委託代理人丙 → 只有一張待辦(一項計畫,記兩位被代理者)
  const joint = await workflowInstance(world.applicant.token, instanceId);
  const jointPlan =
    joint.steps.find((step) => step.stepKey === "joint")?.plan ?? [];
  expect(jointPlan).toHaveLength(1);
  expect(jointPlan[0]?.assignee.id).toBe(delegate.userId);
  const delegateTasks = await myTasks(delegate.token);
  expect(delegateTasks).toHaveLength(1);
  expect(delegateTasks[0]?.stepKey).toBe("joint");
  expect(await myTasks(storeB.token)).toHaveLength(0);

  // 步驟 3:代理人丙打開會簽 → 一次核准就把兩位的名額都算完(全部核准才過的關卡直接通過)
  await page.goto(APPLY_CENTER_ROUTE);
  await page.getByRole("tab", { name: "待我審核" }).click();
  await expect(
    page.getByRole("button", { name: `開啟「${title}」` }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: `開啟「${title}」` }).click();
  await expect(progressRow(page, "店長會簽", "審核中")).toContainText(
    `${delegate.name}(代理 ${storeA.name}、${storeB.name})`,
  );
  await decideInUi(page, "核准");
  await expect(progressRow(page, "店長會簽", "已通過")).toBeVisible();
  await expect(
    timelineEntry(
      page,
      `「店長會簽」由 ${delegate.name} 代理 ${storeA.name}、${storeB.name} 核准`,
    ),
  ).toBeVisible();
  expect(await submissionStatus(world.applicant.token, submitted.id)).toBe(
    "COMPLETED",
  );

  // 前置:刪除前再送一張 → 店長審核已派給代理人丙(代理 店長甲)
  const pendingTitle = `請款一千-${tenant.slug}`;
  const pending = await submitForm(world.applicant.token, world.formKey, {
    title: pendingTitle,
    amount: 1000,
  });
  expect(await taskSubmissionIds(delegate.token)).toEqual([pending.id]);

  // 步驟 4:店長甲刪除代理(進行中的代理可以刪)
  await openDelegationsTab(page, storeA);
  await delegationRow(page, delegate)
    .getByRole("button", { name: `刪除 ${delegate.name} 的代理` })
    .click();
  const confirm = page.getByRole("dialog", {
    name: `刪除 ${delegate.name} 的代理?`,
  });
  await clickAndWaitForOperation(
    page,
    confirm.getByRole("button", { name: "刪除", exact: true }),
    "DeleteMyDelegation",
  );
  await expect(delegationRow(page, delegate)).toHaveCount(0);

  // 預期:已派出的任務不變 —— 刪除前那一張仍在代理人丙手上,沒有轉回店長甲
  expect(await taskSubmissionIds(delegate.token)).toEqual([pending.id]);

  // 預期:之後送出的單,店長審核回到店長甲名下;代理人丙的待我審核看不到它
  const afterTitle = `請款三千-${tenant.slug}`;
  const after = await submitForm(world.applicant.token, world.formKey, {
    title: afterTitle,
    amount: 3000,
  });
  expect(await taskSubmissionIds(storeA.token)).toEqual([after.id]);
  expect(await taskSubmissionIds(delegate.token)).toEqual([pending.id]);
  await signInAgain(page, delegate.account, delegate.password);
  await page.goto(APPLY_CENTER_ROUTE);
  await page.getByRole("tab", { name: "待我審核" }).click();
  await expect(
    page.getByRole("button", { name: `開啟「${pendingTitle}」` }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `開啟「${afterTitle}」` }),
  ).toHaveCount(0);
  await openTaskInApplyCenter(page, storeA, afterTitle);
  await expect(stepProgress(page)).toBeVisible();
  await expect(progressRow(page, "店長審核", "審核中")).toContainText(
    storeA.name,
  );
});
