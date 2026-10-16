import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  type WorkflowFieldsFragment,
  WorkflowVersionStatus,
} from "@repo/graphql";

import { captureDownloads } from "@/test/download";
import type { WorkflowDesignWorldOptions } from "@/test/msw/workflow-design-handlers";
import {
  leaveWorkflowDefinition,
  purchaseWorkflowDefinition,
  workflowFragment,
  workflowVersionFragment,
} from "@/test/msw/workflow-fixtures";
import { setupReactFlowEnvironment } from "@/test/react-flow";
import { findSnackbarAlert } from "@/test/snackbar";

import { renderWorkflows } from "./workflows-page-test-support";

setupReactFlowEnvironment();

beforeAll(async () => {
  await import("./WorkflowsPage");
});

const downloads = captureDownloads();

const EXPORT = "匯出專案設定";
const KEY = "purchase_review";

type TestUser = ReturnType<typeof renderWorkflows>["user"];

/** root 視角的共用流程「採購審核」(平行分支):草稿、已發布的第 2 版(目前版本)、已退役的第 1 版。 */
const sharedWorkflow = (
  overrides: Partial<WorkflowFieldsFragment> = {},
): WorkflowDesignWorldOptions => ({
  workflows: [
    workflowFragment({
      key: KEY,
      name: "採購審核",
      isShared: true,
      ownerOrgId: null,
      ownerOrgName: null,
      currentVersion: 2,
      ...overrides,
    }),
  ],
  versions: {
    [KEY]: [
      workflowVersionFragment(purchaseWorkflowDefinition(), {
        id: "wv-purchase-draft",
        workflowKey: KEY,
        baseVersion: 2,
      }),
      workflowVersionFragment(purchaseWorkflowDefinition(), {
        id: "wv-purchase-2",
        workflowKey: KEY,
        version: 2,
        status: WorkflowVersionStatus.Published,
        checkFormKey: "sick_leave",
        changelog: "第二版",
      }),
      workflowVersionFragment(leaveWorkflowDefinition(), {
        id: "wv-purchase-1",
        workflowKey: KEY,
        version: 1,
        status: WorkflowVersionStatus.Retired,
        changelog: "第一版",
      }),
    ],
  },
});

const openVersions = async (user: TestUser): Promise<HTMLElement> => {
  await user.click(await screen.findByRole("tab", { name: "流程版本" }));
  const table = await screen.findByRole("table", { name: "流程版本" });
  await within(table).findByText("第 1 版");
  return table;
};

const rowOf = (table: HTMLElement, version: string): HTMLElement =>
  within(table).getByRole("row", { name: new RegExp(version) });

const openExport = async (user: TestUser): Promise<HTMLElement> => {
  const table = await openVersions(user);
  await user.click(
    within(rowOf(table, "第 2 版")).getByRole("button", { name: EXPORT }),
  );
  return screen.findByRole("dialog", { name: EXPORT });
};

const fill = async (
  user: TestUser,
  dialog: HTMLElement,
  revision: string,
  changelog: string,
): Promise<void> => {
  await user.type(
    within(dialog).getByRole("textbox", { name: "版本識別" }),
    revision,
  );
  await user.type(
    within(dialog).getByRole("textbox", { name: "發布說明" }),
    changelog,
  );
};

describe("流程管理:版本面板的「匯出專案設定」", () => {
  it("只有目前發布的版本有按鈕;填版本識別與發布說明 → 下載 api 給的 .seed.ts(檔名與內容原樣),版本清單不變", async () => {
    const { user, world } = renderWorkflows({ world: sharedWorkflow() });
    const table = await openVersions(user);

    expect(within(table).getAllByRole("button", { name: EXPORT })).toHaveLength(
      1,
    );
    expect(
      within(rowOf(table, "第 1 版")).queryByRole("button", { name: EXPORT }),
    ).toBeNull();
    expect(
      within(rowOf(table, "草稿")).queryByRole("button", { name: EXPORT }),
    ).toBeNull();

    await user.click(
      within(rowOf(table, "第 2 版")).getByRole("button", { name: EXPORT }),
    );
    const dialog = await screen.findByRole("dialog", { name: EXPORT });
    expect(
      within(dialog).getByText(
        "把流程「採購審核」的第 2 版下載成一個設定檔,交給開發人員放進專案,其他環境就會拿到同一份設計。",
      ),
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "下載設定檔" });
    expect(confirm).toBeDisabled();

    await fill(user, dialog, "r2", "平行分支上線");
    await user.click(confirm);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: EXPORT })).toBeNull();
    });
    expect(world.inputs.exportSeed).toEqual([
      {
        workflowKey: KEY,
        version: 2,
        revision: "r2",
        changelog: "平行分支上線",
      },
    ]);
    expect(downloads.map(({ fileName }) => fileName)).toEqual([
      "purchase_review.r2.seed.ts",
    ]);
    const source = await downloads.at(0)?.text();
    expect(source).toContain(
      'import type { SeedSet } from "@repo/domain/seed";',
    );
    expect(source).toContain('kind: "workflow-definition"');
    expect(source).toContain('key: "purchase_review"');
    expect(source).toContain('revision: "r2"');
    expect(source).toContain('changelog: "平行分支上線"');
    expect(source).toContain('desiredStatus: "published"');
    expect(source).toContain('checkFormKey: "sick_leave"');
    // 第 2 版的內容(平行分支),不是第 1 版或草稿
    expect(source).toContain('name: "三部門匯合"');
    expect(source).toContain('from: "merge"');
    expect(source).toMatch(/\} satisfies SeedSet;\n$/);
    expect(await findSnackbarAlert()).toEqual({
      text: "已下載 purchase_review.r2.seed.ts",
      severity: "success",
    });
    // 既有的版本操作都還在
    const refreshed = screen.getByRole("table", { name: "流程版本" });
    expect(
      within(refreshed).getByRole("button", { name: "發布" }),
    ).toBeInTheDocument();
    expect(
      within(refreshed).getByRole("button", { name: "退役" }),
    ).toBeInTheDocument();
    expect(
      within(refreshed).getByRole("button", { name: "檢視 v2" }),
    ).toBeInTheDocument();
  });

  it("這一版夾帶只在本環境有意義的設定:整份不下載,逐項列出位置與修正說明,彈窗留著", async () => {
    const { user } = renderWorkflows({
      world: {
        ...sharedWorkflow(),
        failures: {
          ExportWorkflowSeed: {
            code: "VALIDATION_FAILED",
            extensions: {
              fields: ["definition"],
              issues: [
                {
                  code: "ASSIGNEE_NOT_PORTABLE",
                  message: "共用流程的關卡不能指名使用者(USERS_IN_SHARED)",
                  path: "definition.steps.0.assignee.userIds",
                },
              ],
            },
          },
        },
      },
    });
    const dialog = await openExport(user);
    await fill(user, dialog, "r2", "說明");

    await user.click(
      within(dialog).getByRole("button", { name: "下載設定檔" }),
    );

    expect(
      await within(dialog).findByText("這一版還不能匯出。"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "definition.steps.0.assignee.userIds:共用流程的關卡不能指名使用者(USERS_IN_SHARED)",
      ),
    ).toBeInTheDocument();
    expect(downloads).toEqual([]);
    expect(await findSnackbarAlert()).toEqual({
      text: "這一版還不能匯出。",
      severity: "error",
    });
  });

  it("api 拒絕(權限不足):顯示原因、不下載", async () => {
    const { user } = renderWorkflows({
      world: {
        ...sharedWorkflow(),
        failures: { ExportWorkflowSeed: { code: "FORBIDDEN" } },
      },
    });
    const dialog = await openExport(user);
    await fill(user, dialog, "r2", "說明");

    await user.click(
      within(dialog).getByRole("button", { name: "下載設定檔" }),
    );

    expect(
      await within(dialog).findByText("你沒有匯出專案設定的權限。"),
    ).toBeInTheDocument();
    expect(downloads).toEqual([]);
  });

  it.each([
    [
      "租戶看分派來的共用流程(不能發布)",
      sharedWorkflow({
        abilities: {
          canEdit: false,
          canPublish: false,
          canAssign: false,
          canFork: true,
        },
      }),
    ],
    [
      "租戶自己的客製流程(能發布,但不是共用)",
      sharedWorkflow({
        isShared: false,
        ownerOrgId: "org-1",
        ownerOrgName: "CookHome",
      }),
    ],
  ])("不可用:%s 沒有匯出按鈕", async (_title, world) => {
    const { user } = renderWorkflows({ world });

    const table = await openVersions(user);

    expect(within(table).queryByRole("button", { name: EXPORT })).toBeNull();
    // 其他不受影響:檢視仍在
    expect(
      within(table).getByRole("button", { name: "檢視 v2" }),
    ).toBeInTheDocument();
  });
});
