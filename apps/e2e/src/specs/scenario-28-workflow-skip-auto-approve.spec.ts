import {
  createWorkflowWorld,
  decideInUi,
  openInstanceDetail,
  openTaskInApplyCenter,
  progressRow,
  reviewStep,
  timelineEntry,
  usersOf,
} from "../fixtures/scenario-workflows";
import { expect, test } from "../fixtures/test";
import {
  approveAs,
  myTasks,
  publishCustomWorkflow,
  submissionStatus,
  submitForm,
  taskSubmissionIds,
  workflowInstance,
} from "../fixtures/workflow-api";

/**
 * 劇本 28 — 指定組織跳過與自動通過
 * 正本:`docs/testing/permission-scenarios.md`「劇本 28」;規則見 `docs/concepts/workflow-engine.md`「跳過與自動通過」。
 * 用哪一頁:申請中心詳情頁(關卡進度、審核歷程)。
 * 前置(走 api):申請人所屬 = 南港廚房(南港店的下層)。客製流程(直線):
 * 1. 分店初審(副理):申請人屬於「南港店」**含下層**就跳過 → 跳過
 * 2. 主管審核(南港主管):申請人屬於「南港店」**不含下層**就跳過 → 不成立,照常審核
 * 3. 申請人確認(申請人):開「申請人是這一關的審核者 → 自動通過」
 * 4. 主管會簽(南港主管、人資,全部核准):開「審核者已在前面的關卡核准過 → 自動通過」
 */
test("劇本 28:申請人屬於指定組織的關卡直接跳過;申請人是審核者、已在前關核准的審核者自動通過", async ({
  page,
  tenant,
}) => {
  test.setTimeout(240_000);
  const world = await createWorkflowWorld(tenant, { formName: "報修單" });
  await publishCustomWorkflow(tenant.tenantAdmin.token, {
    key: `repair_${tenant.slug}`,
    name: "報修審核",
    definition: {
      steps: [
        reviewStep("branch", "分店初審", usersOf(world.deputy), {
          skipOrgs: { orgIds: [tenant.nangangOrgId], includeDescendants: true },
        }),
        reviewStep("manager", "主管審核", usersOf(world.manager), {
          skipOrgs: {
            orgIds: [tenant.nangangOrgId],
            includeDescendants: false,
          },
        }),
        reviewStep("self", "申請人確認", usersOf(world.applicant), {
          autoApprove: { applicant: true },
        }),
        reviewStep("joint", "主管會簽", usersOf(world.manager, world.hr), {
          mode: "all",
          autoApprove: { priorApprover: true },
        }),
      ],
      edges: null,
    },
    bindFormKey: world.formKey,
  });
  const title = `冷氣報修-${tenant.slug}`;
  const submitted = await submitForm(world.applicant.token, world.formKey, {
    title,
    amount: 1,
  });
  const instanceId = submitted.currentInstanceId ?? "";

  // 預期(送出後):分店初審跳過、副理沒有任務;不含下層的那一關不成立 → 主管拿到任務
  expect(await myTasks(world.deputy.token)).toHaveLength(0);
  expect(await taskSubmissionIds(world.manager.token)).toEqual([submitted.id]);

  // 步驟 1:申請人開詳情:「分店初審:已跳過」,時間軸寫出是哪一項成立
  await openInstanceDetail(page, world.applicant, instanceId);
  await expect(progressRow(page, "分店初審", "已跳過")).toBeVisible();
  await expect(
    timelineEntry(page, "「分店初審」申請人屬於指定的組織,略過"),
  ).toBeVisible();
  await expect(progressRow(page, "主管審核", "審核中")).toBeVisible();

  // 步驟 2:主管在詳情頁核准「主管審核」
  await openTaskInApplyCenter(page, world.manager, title);
  await decideInUi(page, "核准");

  // 預期:申請人確認 → 申請人是審核者,自動通過;主管會簽 → 主管已在前關核准,自動記他一票,人資照常審核
  await expect(progressRow(page, "申請人確認", "已通過")).toBeVisible();
  await expect(
    timelineEntry(
      page,
      `${world.applicant.name} 在「申請人確認」核准(申請人是審核者,自動通過)`,
    ),
  ).toBeVisible();
  await expect(progressRow(page, "主管會簽", "審核中")).toBeVisible();
  await expect(
    timelineEntry(
      page,
      `${world.manager.name} 在「主管會簽」核准(已在前關核准,自動通過)`,
    ),
  ).toBeVisible();
  expect(await myTasks(world.manager.token)).toHaveLength(0);
  expect(await taskSubmissionIds(world.hr.token)).toEqual([submitted.id]);
  const running = await workflowInstance(world.applicant.token, instanceId);
  expect(running.steps.find((step) => step.stepKey === "branch")?.status).toBe(
    "SKIPPED",
  );

  // 步驟 3:人資核准 → 全部核准才過的會簽通過 → 已完成(跳過的關卡沒有人核准)
  await approveAs(world.hr.token, submitted.id);
  expect(await submissionStatus(world.applicant.token, submitted.id)).toBe(
    "COMPLETED",
  );
  await openInstanceDetail(page, world.applicant, instanceId);
  await expect(progressRow(page, "主管會簽", "已通過")).toBeVisible();
  await expect(progressRow(page, "分店初審", "已跳過")).toBeVisible();
  await expect(timelineEntry(page, "在「分店初審」核准")).toHaveCount(0);
});
