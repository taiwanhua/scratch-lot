import {
  APPLY_CENTER_ROUTE,
  createWorkflowWorld,
  decideInUi,
  extraPerson,
  notificationItems,
  openNotifications,
  openTaskInApplyCenter,
  progressRow,
  reviewStep,
  stepProgress,
  usersOf,
} from "../fixtures/scenario-workflows";
import { expect, test } from "../fixtures/test";
import { signInAgain } from "../fixtures/ui";
import {
  approveAs,
  decideTask,
  formSubmission,
  myNotifications,
  notificationsMatching,
  pendingTaskOf,
  publishCustomWorkflow,
  submitExisting,
  submitForm,
  voidSubmission,
} from "../fixtures/workflow-api";

const CC = "workflow.cc";

/** 某人收到、主旨是這張單的知會通知內文(排序後比對,不看先後)。 */
async function ccBodies(token: string, subject: string): Promise<string[]> {
  const items = await notificationsMatching(token, CC, subject);
  return items
    .map((item) => item.body)
    .toSorted((left, right) => left.localeCompare(right));
}

/** 依同一規則排序的預期內文。 */
function sorted(...bodies: string[]): string[] {
  return bodies.toSorted((left, right) => left.localeCompare(right));
}

/**
 * 劇本 26 — 知會
 * 正本:`docs/testing/permission-scenarios.md`「劇本 26」;規則見 `docs/concepts/workflow-engine.md`「逾時提醒與知會」。
 * 用哪一頁:申請中心詳情頁(主管審核)、頂端列的通知鈴(知會對象)、申請中心詳情頁(知會對象唯讀)。
 * 前置(走 api):客製流程「主管審核(南港主管;關卡知會 = 關卡知會人)→ 分店覆核(副理;申請人屬於南港店含下層就跳過;
 * 關卡知會 = 關卡知會人)」,整個流程的知會 = 流程知會人;並綁定。
 */
test("劇本 26:關卡通過 / 被跳過知會該關的知會對象;完成、駁回、作廢知會整個流程的知會對象;退回不知會", async ({
  page,
  tenant,
}) => {
  test.setTimeout(300_000);
  const world = await createWorkflowWorld(tenant, {
    formName: "出差單",
    extra: { cs: "關卡知會人", cf: "流程知會人" },
  });
  const stepCc = extraPerson(world, "cs");
  const flowCc = extraPerson(world, "cf");
  await publishCustomWorkflow(tenant.tenantAdmin.token, {
    key: `trip_${tenant.slug}`,
    name: "出差審核",
    definition: {
      steps: [
        reviewStep("manager", "主管審核", usersOf(world.manager), {
          cc: usersOf(stepCc),
        }),
        reviewStep("branch", "分店覆核", usersOf(world.deputy), {
          skipOrgs: { orgIds: [tenant.nangangOrgId], includeDescendants: true },
          cc: usersOf(stepCc),
        }),
      ],
      edges: null,
      cc: usersOf(flowCc),
    },
    bindFormKey: world.formKey,
  });

  // 步驟 1:主管在詳情頁核准 → 主管審核通過、分店覆核被跳過、單據完成
  const doneTitle = `出差台中-${tenant.slug}`;
  const done = await submitForm(world.applicant.token, world.formKey, {
    title: doneTitle,
    amount: 2,
  });
  await openTaskInApplyCenter(page, world.manager, doneTitle);
  await decideInUi(page, "核准");
  await expect(progressRow(page, "主管審核", "已通過")).toBeVisible();
  await expect(progressRow(page, "分店覆核", "已跳過")).toBeVisible();

  // 預期:關卡知會人收兩則(通過、跳過),流程知會人只收「已完成」
  const doneSubject = `出差單:${doneTitle}`;
  const stepCcBodies = sorted(
    `申請「${doneSubject}」的「主管審核」關卡已通過。`,
    `申請「${doneSubject}」的「分店覆核」關卡已跳過。`,
  );
  expect(await ccBodies(stepCc.token, doneSubject)).toEqual(stepCcBodies);
  expect(await ccBodies(flowCc.token, doneSubject)).toEqual([
    `申請「${doneSubject}」已完成。`,
  ]);

  // 步驟 2:關卡知會人 → 通知鈴看到兩則 → 點「關卡已通過」那一則 → 進詳情頁唯讀(沒有審核按鈕)
  await signInAgain(page, stepCc.account, stepCc.password);
  const panel = await openNotifications(page);
  await expect(notificationItems(panel, doneSubject)).toHaveCount(2);
  await notificationItems(panel, "「主管審核」關卡已通過").click();
  await page.waitForURL((url) =>
    url.pathname.startsWith(`${APPLY_CENTER_ROUTE}/view-page/`),
  );
  await expect(stepProgress(page)).toBeVisible();
  await expect(progressRow(page, "分店覆核", "已跳過")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "核准", exact: true }),
  ).toHaveCount(0);

  // 步驟 3:申請人作廢那張已完成的單(api)→ 流程知會人收「已作廢」;關卡知會人不收
  await voidSubmission(world.applicant.token, done.id, "行程取消");
  expect(await ccBodies(flowCc.token, doneSubject)).toEqual(
    sorted(`申請「${doneSubject}」已完成。`, `申請「${doneSubject}」已作廢。`),
  );
  expect(await ccBodies(stepCc.token, doneSubject)).toEqual(stepCcBodies);

  // 步驟 4:另一張被主管駁回 → 流程知會人收「已駁回」;關卡沒通過,關卡知會人什麼都沒收
  const rejectTitle = `出差高雄-${tenant.slug}`;
  const rejected = await submitForm(world.applicant.token, world.formKey, {
    title: rejectTitle,
    amount: 5,
  });
  await decideTask(
    world.manager.token,
    await pendingTaskOf(world.manager.token, rejected.id),
    "REJECT",
    "預算不足",
  );
  const rejectSubject = `出差單:${rejectTitle}`;
  expect(await ccBodies(flowCc.token, rejectSubject)).toEqual([
    `申請「${rejectSubject}」已駁回。`,
  ]);
  expect(await ccBodies(stepCc.token, rejectSubject)).toEqual([]);

  // 步驟 5:另一張被主管退回修改 → 誰都不知會
  const returnTitle = `出差花蓮-${tenant.slug}`;
  const returned = await submitForm(world.applicant.token, world.formKey, {
    title: returnTitle,
    amount: 3,
  });
  await decideTask(
    world.manager.token,
    await pendingTaskOf(world.manager.token, returned.id),
    "RETURN",
    "天數寫錯",
  );
  const returnSubject = `出差單:${returnTitle}`;
  expect(await ccBodies(flowCc.token, returnSubject)).toEqual([]);
  expect(await ccBodies(stepCc.token, returnSubject)).toEqual([]);

  // 步驟 6:申請人改好再送(新實例、從第一關重審)→ 主管核准 → 關卡知會人這次才收到通過 / 跳過
  const back = await formSubmission(world.applicant.token, returned.id);
  await submitExisting(world.applicant.token, returned.id, back.editVersion);
  await approveAs(world.manager.token, returned.id);
  expect(await ccBodies(stepCc.token, returnSubject)).toEqual(
    sorted(
      `申請「${returnSubject}」的「主管審核」關卡已通過。`,
      `申請「${returnSubject}」的「分店覆核」關卡已跳過。`,
    ),
  );
  // 重送後走完 → 流程知會人收到這張的「已完成」(退回那一輪沒收過任何一則)
  expect(await ccBodies(flowCc.token, returnSubject)).toEqual([
    `申請「${returnSubject}」已完成。`,
  ]);

  // 流程知會人 → 通知鈴:台中(完成、作廢)、高雄(駁回)、花蓮(重送後完成)共四則,只有知會
  await signInAgain(page, flowCc.account, flowCc.password);
  const flowPanel = await openNotifications(page);
  await expect(notificationItems(flowPanel, "知會:")).toHaveCount(4);
  const flowInbox = await myNotifications(flowCc.token);
  expect(flowInbox.items.map((item) => item.type)).toEqual([CC, CC, CC, CC]);
});
