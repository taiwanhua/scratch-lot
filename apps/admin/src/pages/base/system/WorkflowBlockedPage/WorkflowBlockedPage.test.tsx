import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { WorkflowInstanceStatus, WorkflowStepStatus } from "@repo/graphql";

import { autocompleteOption } from "@/test/autocomplete";
import { authWorld } from "@/test/msw/auth-handlers";
import { server } from "@/test/msw/server";
import { workflowCatalogHandlers } from "@/test/msw/workflow-catalog-handlers";
import {
  APPLICANT,
  BLOCKED_ROUTE,
  MANAGER,
  instanceFragment,
  instanceStep,
  planItem,
  workflowsModules,
} from "@/test/msw/workflow-fixtures";
import {
  type WorkflowRuntimeWorldOptions,
  workflowRuntimeWorld,
} from "@/test/msw/workflow-runtime-handlers";
import { renderApp } from "@/test/render";
import { currentSearch, urlJson } from "@/test/url-reload";

/** 主管關卡的承辦人小華被停用(`invalid`)→ 實例阻擋;人資關解析為空的另一張。 */
const blockedInstances = () => [
  instanceFragment({
    status: WorkflowInstanceStatus.Blocked,
    abilities: { canWithdraw: false, canManage: true },
    steps: [
      instanceStep("manager", "直屬主管", {
        status: WorkflowStepStatus.Active,
        blocked: true,
        plan: [
          planItem("manager-1", MANAGER, {
            assigneeState: "invalid",
            taskId: "task-manager-1",
          }),
        ],
      }),
      instanceStep("hr", "人資"),
    ],
  }),
  instanceFragment({
    id: "inst-2",
    submissionId: "sub-leave-2",
    status: WorkflowInstanceStatus.Blocked,
    summary: { title: "事假一天", date: null, amount: null },
    activeStepKeys: ["hr"],
    steps: [
      instanceStep("manager", "直屬主管", {
        status: WorkflowStepStatus.Completed,
      }),
      instanceStep("hr", "人資", {
        status: WorkflowStepStatus.Active,
        blocked: true,
      }),
    ],
  }),
];

const renderBlocked = (
  world: WorkflowRuntimeWorldOptions,
  timezone?: string,
  /** 起始網址的查詢字串(含 `?`;重新整理用) */
  search = "",
) => {
  const runtime = workflowRuntimeWorld({
    instances: blockedInstances(),
    blocked: { blocked: ["inst-1", "inst-2"] },
    ...world,
  });
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      modules: workflowsModules(
        ["system.workflows.view"],
        ["system.workflows.blocked-page.reassign"],
      ),
      currentOrgTimezone: timezone,
    }).handlers,
    ...runtime.handlers,
    ...workflowCatalogHandlers(),
  );
  return {
    ...renderApp({ path: `${BLOCKED_ROUTE}${search}` }),
    world: runtime,
  };
};

beforeAll(async () => {
  // 懶載入的頁面先載進模組快取(TEST-08)
  await import("./WorkflowBlockedPage");
});

describe("阻擋清單", () => {
  it("列出卡在哪、卡在誰(失效的承辦人 / 找不到審核者),不含提交內容", async () => {
    renderBlocked({});

    const table = await screen.findByRole("table", { name: "阻擋清單" });
    expect(
      await within(table).findByText("「直屬主管」小華(已失效)"),
    ).toBeInTheDocument();
    expect(within(table).getByText("「人資」找不到審核者")).toBeInTheDocument();
    expect(within(table).getByText("病假三天")).toBeInTheDocument();
    expect(within(table).getAllByText(APPLICANT.name)).toHaveLength(2);
  });

  it("最後變動用讀者的租戶時區(不是預設的台北、也不是執行環境的時區)", async () => {
    renderBlocked({}, "America/New_York");

    const table = await screen.findByRole("table", { name: "阻擋清單" });
    // 夾具 2026-09-20T02:00Z → 紐約(夏令 UTC−4)09-19 22:00
    expect(await within(table).findAllByText("2026-09-19 22:00")).toHaveLength(
      2,
    );
  });

  it("改派:選一位本租戶的人(申請人自己、已在本關的人、停用的人不能選)→ reassignTask 帶任務 id", async () => {
    const { user, world } = renderBlocked({});
    const table = await screen.findByRole("table", { name: "阻擋清單" });
    await within(table).findByText("「直屬主管」小華(已失效)");

    await user.click(within(table).getByRole("button", { name: "改派" }));
    const dialog = await screen.findByRole("dialog", {
      name: "改派「直屬主管」",
    });
    await user.click(within(dialog).getByRole("combobox", { name: "審核者" }));
    await screen.findAllByRole("option");
    expect(autocompleteOption("小明")).toHaveAttribute("aria-disabled", "true");
    expect(autocompleteOption("離職的老王")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(autocompleteOption("副理阿強"));
    await user.click(within(dialog).getByRole("button", { name: "確定" }));

    await waitFor(() => {
      expect(world.inputs.reassign).toEqual([
        { taskId: "task-manager-1", toUserId: "user-4" },
      ]);
    });
  });

  it("解析為空的關卡 → 新增審核者(addStepAssignee 帶實例與關卡)", async () => {
    const { user, world } = renderBlocked({});
    const table = await screen.findByRole("table", { name: "阻擋清單" });
    await within(table).findByText("「人資」找不到審核者");

    await user.click(within(table).getByRole("button", { name: "新增審核者" }));
    const dialog = await screen.findByRole("dialog", {
      name: "「人資」新增審核者",
    });
    await user.click(within(dialog).getByRole("combobox", { name: "審核者" }));
    await screen.findAllByRole("option");
    await user.click(autocompleteOption("人資阿美"));
    await user.click(within(dialog).getByRole("button", { name: "確定" }));

    await waitFor(() => {
      expect(world.inputs.addAssignee).toEqual([
        { instanceId: "inst-2", stepKey: "hr", userId: "user-3" },
      ]);
    });
  });

  it("「需要推進」篩選:查詢帶 NEEDS_ADVANCE;候選太多時提示只檢查了一批;重試推進", async () => {
    const { user, world } = renderBlocked({
      blocked: { needsAdvance: ["inst-1"], truncated: true },
    });
    await screen.findByRole("table", { name: "阻擋清單" });

    await user.click(screen.getByRole("tab", { name: "需要推進" }));

    expect(
      await screen.findByText(/只檢查了最久沒有變動的一批/),
    ).toBeInTheDocument();
    expect(world.inputs.blocked.at(-1)?.filter).toBe("NEEDS_ADVANCE");
    const table = screen.getByRole("table", { name: "阻擋清單" });
    await within(table).findByText("病假三天");
    await user.click(within(table).getByRole("button", { name: "重試推進" }));
    await waitFor(() => {
      expect(world.inputs.retry).toEqual(["inst-1"]);
    });
  });

  it("篩選與頁碼存在網址 `?list=`(REACT-14):重新整理後還停在「需要推進」", async () => {
    const first = renderBlocked({ blocked: { needsAdvance: ["inst-1"] } });
    await screen.findByRole("table", { name: "阻擋清單" });
    await first.user.click(screen.getByRole("tab", { name: "需要推進" }));
    await waitFor(() => {
      expect(urlJson("list")).toEqual({ filter: "NEEDS_ADVANCE", page: 1 });
    });
    first.unmount();

    const second = renderBlocked(
      { blocked: { needsAdvance: ["inst-1"] } },
      undefined,
      currentSearch(),
    );

    expect(
      await screen.findByRole("tab", { name: "需要推進" }),
    ).toHaveAttribute("aria-selected", "true");
    await waitFor(() => {
      expect(second.world.inputs.blocked.at(-1)?.filter).toBe("NEEDS_ADVANCE");
    });
  });
});
