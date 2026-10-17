import { fireEvent, screen, within } from "@testing-library/react";

import { WorkflowVersionStatus } from "@repo/graphql";

import { authWorld } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import {
  type WorkflowCatalogOptions,
  workflowCatalogHandlers,
} from "@/test/msw/workflow-catalog-handlers";
import {
  type WorkflowDesignWorld,
  type WorkflowDesignWorldOptions,
  workflowDesignWorld,
} from "@/test/msw/workflow-design-handlers";
import {
  WORKFLOWS_ROUTE,
  leaveWorkflowDefinition,
  workflowFragment,
  workflowVersionFragment,
  workflowsModules,
} from "@/test/msw/workflow-fixtures";
import { renderApp } from "@/test/render";

/**
 * 流程管理頁測試的共用場景(TEST-08:一份形狀,測試檔只寫行為)。三個旋鈕:模組權限、
 * 阻擋清單權限、假 api 的狀態(`world`)。
 */
export const WORKFLOWS_ALL = ["system.workflows.*"];

/** 客製流程「病假審核」:已發布第 1 版 + 一份以它為基底的草稿(修訂 1)。 */
export const defaultDesignOptions = (): WorkflowDesignWorldOptions => ({
  workflows: [workflowFragment()],
  versions: {
    leave_review: [
      workflowVersionFragment(leaveWorkflowDefinition(), { baseVersion: 1 }),
      workflowVersionFragment(leaveWorkflowDefinition(), {
        id: "wv-leave-1",
        version: 1,
        status: WorkflowVersionStatus.Published,
        changelog: "第一版",
      }),
    ],
  },
});

export interface WorkflowsSetup {
  path?: string;
  permissions?: readonly string[];
  blockedPermissions?: readonly string[];
  world?: WorkflowDesignWorldOptions;
  catalog?: WorkflowCatalogOptions;
}

export const renderWorkflows = ({
  path = WORKFLOWS_ROUTE,
  permissions = WORKFLOWS_ALL,
  blockedPermissions = [],
  world = defaultDesignOptions(),
  catalog,
}: WorkflowsSetup = {}): ReturnType<typeof renderApp> & {
  world: WorkflowDesignWorld;
} => {
  const design = workflowDesignWorld(world);
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      modules: workflowsModules(permissions, blockedPermissions),
    }).handlers,
    ...design.handlers,
    ...workflowCatalogHandlers(catalog),
  );
  return { ...renderApp({ path }), world: design };
};

/** 等設計器掛好(流程圖的第一個節點出現)並回傳流程圖區塊。 */
export const findCanvas = async (): Promise<HTMLElement> => {
  const canvas = await screen.findByRole("region", { name: "流程圖" });
  await within(canvas).findByRole("group", { name: "直屬主管" });
  return canvas;
};

/** 屬性面板。 */
export const propertiesPanel = (): HTMLElement =>
  screen.getByRole("region", { name: "屬性" });

/**
 * 點流程圖上的節點(選取):React Flow 的節點掛了 d3-drag,userEvent 的指標事件會讓 d3 讀
 * `event.view.document` 而在 jsdom 炸掉;點選只需要 click,用 `fireEvent.click`。
 * 拖拉的放置判斷另有純函式測試(`lib/base/workflow/flow-drop.test.ts`),畫面上用「上移 / 下移 / 移到分支」。
 */
export const clickNode = (canvas: HTMLElement, name: string): void => {
  fireEvent.click(within(canvas).getByRole("group", { name }));
};
