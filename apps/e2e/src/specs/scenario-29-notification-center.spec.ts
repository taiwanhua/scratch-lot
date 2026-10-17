import {
  APPLY_CENTER_ROUTE,
  createWorkflowWorld,
  decideInUi,
  notificationBell,
  notificationItems,
  openNotifications,
  progressRow,
  reviewStep,
  usersOf,
} from "../fixtures/scenario-workflows";
import { expect, test } from "../fixtures/test";
import { signInAgain } from "../fixtures/ui";
import {
  decideTask,
  myNotifications,
  notificationsMatching,
  pendingTaskOf,
  publishCustomWorkflow,
  submitForm,
} from "../fixtures/workflow-api";

const TASK_CREATED = "workflow.task-created";
const RESULT = "workflow.result";

/**
 * 劇本 29 — 通知中心
 * 正本:`docs/testing/permission-scenarios.md`「劇本 29」;規則見《底座規格》第 5 章。
 * 用哪一頁:頂端列的通知鈴(未讀數、清單、全部 / 未讀、標已讀、點一則開連結)。
 * 前置(走 api):客製流程只有一關「主管審核」(南港主管)並綁定;申請人送出。
 * E2E 不起即時通道:新通知由頁面重新載入(或斷線輪詢)取得,不靠信號。
 */
test("劇本 29:流程動作產生通知 → 通知鈴看得到、點開標已讀;全部標已讀;同一事件不重複通知", async ({
  page,
  tenant,
}) => {
  test.setTimeout(240_000);
  const world = await createWorkflowWorld(tenant, { formName: "採購單" });
  await publishCustomWorkflow(tenant.tenantAdmin.token, {
    key: `buy_${tenant.slug}`,
    name: "採購審核",
    definition: {
      steps: [reviewStep("manager", "主管審核", usersOf(world.manager))],
      edges: null,
    },
    bindFormKey: world.formKey,
  });
  const title = `買投影機-${tenant.slug}`;
  const subject = `採購單:${title}`;
  const submitted = await submitForm(world.applicant.token, world.formKey, {
    title,
    amount: 1,
  });
  const instanceId = submitted.currentInstanceId ?? "";

  // 步驟 1:主管登入 → 通知鈴顯示 1 則未讀 → 打開:「待審核:採購單:<標題>」
  await signInAgain(page, world.manager.account, world.manager.password);
  await expect(notificationBell(page)).toHaveAccessibleName("通知,1 則未讀");
  const panel = await openNotifications(page);
  const taskItem = notificationItems(panel, `待審核:${subject}`);
  await expect(taskItem).toHaveCount(1);
  await expect(taskItem).toContainText(
    `您有一筆待審核的申請「${subject}」(關卡:主管審核)。`,
  );
  await expect(taskItem.getByRole("img", { name: "未讀" })).toBeVisible();

  // 步驟 2:點那一則 → 標已讀並打開申請中心詳情頁;鈴上沒有未讀數
  await taskItem.click();
  await page.waitForURL(`${APPLY_CENTER_ROUTE}/view-page/${instanceId}`);
  await expect(notificationBell(page)).toHaveAccessibleName("通知");
  const managerInbox = await myNotifications(world.manager.token);
  expect(managerInbox.unreadCount).toBe(0);
  expect(managerInbox.items).toEqual([
    expect.objectContaining({
      type: TASK_CREATED,
      refId: instanceId,
      readAt: expect.any(String),
    }),
  ]);

  // 步驟 3:主管在詳情頁核准 → 申請人收到「申請已核准」
  const managerTask = await pendingTaskOf(world.manager.token, submitted.id);
  await expect(progressRow(page, "主管審核", "審核中")).toBeVisible();
  await decideInUi(page, "核准");

  const resultNotes = await notificationsMatching(
    world.applicant.token,
    RESULT,
    subject,
  );
  expect(resultNotes.map((item) => item.title)).toEqual([
    `申請已核准:${subject}`,
  ]);

  // 步驟 4:申請人登入 → 鈴上 1 則未讀 →「未讀」篩選看得到 →「全部標為已讀」
  await signInAgain(page, world.applicant.account, world.applicant.password);
  await expect(notificationBell(page)).toHaveAccessibleName("通知,1 則未讀");
  const inbox = await openNotifications(page);
  await inbox.getByRole("button", { name: "未讀", exact: true }).click();
  await expect(notificationItems(inbox, `申請已核准:${subject}`)).toHaveCount(
    1,
  );
  const resultItem = notificationItems(inbox, `申請已核准:${subject}`);
  await inbox.getByRole("button", { name: "全部標為已讀" }).click();
  // 當下:未讀圓點消失、鈴上沒有未讀數;「未讀」清單先留著那一則(點的當下不跳動,下次重抓才拿掉)
  await expect(resultItem.getByRole("img", { name: "未讀" })).toHaveCount(0);
  await expect(
    inbox.getByRole("button", { name: "全部標為已讀" }),
  ).toBeHidden();
  // 彈出框開著時頁面其他部分對輔助技術隱藏,關掉才看得到鈴
  //(「全部標為已讀」按完就消失,焦點跟著離開彈出框,所以 Escape 要對著彈出框按)
  await inbox.press("Escape");
  await expect(inbox).toBeHidden();
  await expect(notificationBell(page)).toHaveAccessibleName("通知");
  const applicantInbox = await myNotifications(world.applicant.token);
  expect(applicantInbox.unreadCount).toBe(0);

  // 預期:重新整理後仍是已讀(標已讀寫進 api,不是只改畫面):「未讀」清單是空的,「全部」裡還在
  await page.reload();
  await expect(notificationBell(page)).toHaveAccessibleName("通知");
  const reopened = await openNotifications(page);
  await reopened.getByRole("button", { name: "未讀", exact: true }).click();
  await expect(reopened.getByText("沒有未讀的通知")).toBeVisible();
  await reopened.getByRole("button", { name: "全部", exact: true }).click();
  await expect(
    notificationItems(reopened, `申請已核准:${subject}`),
  ).toHaveCount(1);

  // 預期:同一事件不重複 —— 同一張任務再送一次核准:任務已不是待處理,api 回 STEP_CLOSED(不是錯誤、任務不動;
  // task-actions.service.ts 先看任務狀態,再比 editVersion),不會再產生通知:
  // 申請人的結果通知、主管的待審核通知都還是各一則
  const replay = await decideTask(world.manager.token, managerTask, "APPROVE");
  expect(replay).toBe("STEP_CLOSED");
  expect(
    await notificationsMatching(world.applicant.token, RESULT, subject),
  ).toHaveLength(1);
  expect(
    await notificationsMatching(world.manager.token, TASK_CREATED, subject),
  ).toHaveLength(1);
});
