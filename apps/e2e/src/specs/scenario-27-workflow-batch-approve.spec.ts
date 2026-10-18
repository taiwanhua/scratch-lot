import { clickAndWaitForOperation } from "../fixtures/scenario-forms";
import {
  APPLY_CENTER_ROUTE,
  createWorkflowWorld,
  reviewStep,
  usersOf,
} from "../fixtures/scenario-workflows";
import { expect, test } from "../fixtures/test";
import { signInAgain } from "../fixtures/ui";
import {
  myTasks,
  pendingTaskOf,
  publishCustomWorkflow,
  reassignTask,
  submissionStatus,
  submitForm,
  taskSubmissionIds,
} from "../fixtures/workflow-api";

/**
 * 劇本 27 — 批次核准
 * 正本:`docs/testing/permission-scenarios.md`「劇本 27」;規則見 `docs/modules/workflows.md`「批次核准」。
 * 用哪一頁:申請中心「待我審核」(列勾選 → 核准(N)→ 批次核准對話框 → 結果)。
 * 前置(走 api):客製流程只有一關「主管審核」(南港主管)並綁定;申請人送出三張。
 * 主管勾好三筆之後,+tenant 以 api 把其中一張改派給副理(「另一路改派」)。
 *
 * 「`beforeApprove` 擋下 → 那一筆顯示專案的錯誤訊息、保持勾選」:底座的 `PROJECT_FORM_LIFECYCLES` 是空的,
 * E2E 的 stack 沒有任何會擋下的守門,這一列由 api 測試覆蓋(`batch-approve.test.ts`),見文件該劇本。
 */
test("劇本 27:勾三筆批次核准,其中一筆已被改派 → 兩筆成功、一筆「這件已不在你手上」,其他筆不受影響", async ({
  page,
  tenant,
}) => {
  test.setTimeout(240_000);
  const world = await createWorkflowWorld(tenant, { formName: "加班單" });
  await publishCustomWorkflow(tenant.tenantAdmin.token, {
    key: `overtime_${tenant.slug}`,
    name: "加班審核",
    definition: {
      steps: [reviewStep("manager", "主管審核", usersOf(world.manager))],
      edges: null,
    },
    bindFormKey: world.formKey,
  });
  const firstTitle = `加班一小時-${tenant.slug}`;
  const secondTitle = `加班二小時-${tenant.slug}`;
  const thirdTitle = `加班三小時-${tenant.slug}`;
  const titles = [firstTitle, secondTitle, thirdTitle];
  const first = await submitForm(world.applicant.token, world.formKey, {
    title: firstTitle,
    amount: 1,
  });
  const second = await submitForm(world.applicant.token, world.formKey, {
    title: secondTitle,
    amount: 2,
  });
  const third = await submitForm(world.applicant.token, world.formKey, {
    title: thirdTitle,
    amount: 3,
  });

  // 步驟 1:主管 → 申請中心「待我審核」→ 逐列勾選三筆
  await signInAgain(page, world.manager.account, world.manager.password);
  await page.goto(APPLY_CENTER_ROUTE);
  await page.getByRole("tab", { name: "待我審核" }).click();
  const table = page.getByRole("table", { name: "待我審核" });
  for (const title of titles) {
    await table.getByRole("checkbox", { name: `勾選「${title}」` }).check();
  }
  const selectionBar = page.getByRole("region", { name: "已選 3 筆" });
  await expect(selectionBar).toBeVisible();
  await expect(
    selectionBar.getByText("只能批次核准;駁回、退回請逐筆處理"),
  ).toBeVisible();

  // 前置:勾好之後,+tenant 把第三張改派給副理(另一路)
  const thirdTask = await pendingTaskOf(world.manager.token, third.id);
  await reassignTask(
    tenant.tenantAdmin.token,
    thirdTask.id,
    world.deputy.userId,
  );

  // 步驟 2:「核准(3)」→ 對話框填共同意見 →「核准 3 筆」
  await selectionBar.getByRole("button", { name: "核准(3)" }).click();
  const dialog = page.getByRole("dialog", { name: "批次核准" });
  await expect(
    dialog.getByText(
      "將核准已選的 3 筆。每一筆各自處理,被擋下的不影響其他筆。",
    ),
  ).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "共同意見(選填)" })
    .fill("本月加班照准");
  await clickAndWaitForOperation(
    page,
    dialog.getByRole("button", { name: "核准 3 筆" }),
    "BatchApproveTasks",
  );

  // 預期:結果對話框 —— 2 筆已核准、1 筆未完成;逐筆列出結果
  await expect(
    dialog.getByText("2 筆已核准,1 筆未完成(其他筆不受影響)"),
  ).toBeVisible();
  const results = dialog.getByRole("table", { name: "批次核准結果" });
  const resultRow = (title: string) =>
    results.getByRole("row").filter({ hasText: title });
  await expect(resultRow(firstTitle)).toContainText("已核准");
  await expect(resultRow(secondTitle)).toContainText("已核准");
  await expect(resultRow(thirdTitle)).toContainText("這件已不在你手上");
  await dialog.getByRole("button", { name: "關閉" }).click();
  await expect(dialog).toBeHidden();

  // 預期:成功的取消勾選;「已不在你手上」的也不保留勾選(規格的例外)→ 沒有已選列
  await expect(page.getByRole("region", { name: /^已選 \d+ 筆$/ })).toHaveCount(
    0,
  );
  await expect(
    table.getByRole("button", { name: `開啟「${firstTitle}」` }),
  ).toHaveCount(0);
  await expect(
    table.getByRole("button", { name: `開啟「${thirdTitle}」` }),
  ).toHaveCount(0);

  // 預期:兩筆完成;被改派的那張在副理手上、照常待審
  expect(await submissionStatus(world.applicant.token, first.id)).toBe(
    "COMPLETED",
  );
  expect(await submissionStatus(world.applicant.token, second.id)).toBe(
    "COMPLETED",
  );
  expect(await submissionStatus(world.applicant.token, third.id)).toBe(
    "REVIEWING",
  );
  expect(await myTasks(world.manager.token)).toHaveLength(0);
  expect(await taskSubmissionIds(world.deputy.token)).toEqual([third.id]);
});
