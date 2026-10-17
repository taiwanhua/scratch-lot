import {
  createWorkflowWorld,
  decideInUi,
  myApplicationRow,
  openTaskInApplyCenter,
  progressRow,
  reviewStep,
  roleOf,
} from "../fixtures/scenario-workflows";
import { expect, test } from "../fixtures/test";
import {
  myTasks,
  publishCustomWorkflow,
  submissionStatus,
  submitForm,
  taskSubmissionIds,
} from "../fixtures/workflow-api";

/**
 * 劇本 20 — 主管 + 人資兩級核准(含 `manager` 解析)
 * 正本:`docs/testing/permission-scenarios.md`「劇本 20」。
 * 用哪一頁:申請中心(待我審核 → 詳情頁審核區塊;我的申請)。
 * 前置(走 api):申請人在「南港廚房」(南港店的下層,自己沒有主管)、南港店的主管、「人資」角色;
 * 共用表單掛「示範表單(群組內)」、租戶管理員建客製流程「直屬主管(主管第 1 層)→ 人資(角色)」並綁定;申請人送出。
 */
test("劇本 20:主管 + 人資兩級核准,主管從申請所屬組織往上找", async ({
  page,
  tenant,
}) => {
  test.setTimeout(240_000);
  const world = await createWorkflowWorld(tenant, { formName: "病假單" });
  await publishCustomWorkflow(tenant.tenantAdmin.token, {
    key: `leave_${tenant.slug}`,
    name: "病假審核",
    definition: {
      steps: [
        reviewStep("manager", "直屬主管", { kind: "manager", level: 1 }),
        reviewStep("hr", "人資", roleOf(world.hrRoleId)),
      ],
      edges: null,
    },
    bindFormKey: world.formKey,
  });
  const title = `病假三天-${tenant.slug}`;
  const submitted = await submitForm(world.applicant.token, world.formKey, {
    title,
    amount: 3,
  });
  expect(submitted.status).toBe("REVIEWING");

  // 前置(api 送出)後的預期:主管解析 —— 南港廚房沒有主管,往上一層找到南港店的主管;人資還沒拿到任務
  expect(await taskSubmissionIds(world.manager.token)).toContain(submitted.id);
  expect(await myTasks(world.hr.token)).toHaveLength(0);

  // 步驟 1:主管 → 申請中心「待我審核」→ 打開 → 核准
  await openTaskInApplyCenter(page, world.manager, title);
  await expect(progressRow(page, "直屬主管", "審核中")).toBeVisible();
  await decideInUi(page, "核准");
  await expect(progressRow(page, "直屬主管", "已通過")).toBeVisible();
  await expect(progressRow(page, "人資", "審核中")).toBeVisible();

  // 步驟 2:人資(角色來源)→ 核准 → 全案核准
  await openTaskInApplyCenter(page, world.hr, title);
  await decideInUi(page, "核准");
  await expect(progressRow(page, "人資", "已通過")).toBeVisible();

  // 步驟 3:申請人「我的申請」看到已完成
  const row = await myApplicationRow(page, world.applicant, title);
  await expect(row.getByText("已完成")).toBeVisible();
  expect(await submissionStatus(world.applicant.token, submitted.id)).toBe(
    "COMPLETED",
  );
});
