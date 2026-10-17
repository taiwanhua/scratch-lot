import { beforeAll, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { DEFAULT_OVERDUE_AUDIENCE } from "@repo/domain/workflow";

import { workflowFragment } from "@/test/msw/workflow-fixtures";
import { setupReactFlowEnvironment } from "@/test/react-flow";
import { findSnackbarAlert } from "@/test/snackbar";

import {
  clickNode,
  defaultDesignOptions,
  findCanvas,
  propertiesPanel,
  renderWorkflows,
} from "./workflows-page-test-support";

setupReactFlowEnvironment();

beforeAll(async () => {
  // 懶載入頁面的依賴鏈(React Flow、dagre、檢查器)先載好,不算進 findBy* 的等待(TEST-08)
  await import("./WorkflowsPage");
});

const BLOCKED = "逾時提醒的時數不正確,修正後才能存草稿。";

type User = ReturnType<typeof renderWorkflows>["user"];

/** 選一個 `SelectField` 的選項。 */
const pick = async (
  user: User,
  combobox: HTMLElement,
  option: string,
): Promise<void> => {
  await user.click(combobox);
  await user.click(await screen.findByRole("option", { name: option }));
};

/** 「人資」關開啟逾時提醒,把第 2 級時數改成比第 1 級小(M ≤ N)。 */
const makeOverdueInvalid = async (user: User): Promise<void> => {
  const panel = propertiesPanel();
  await user.click(within(panel).getByRole("switch", { name: "開啟逾時提醒" }));
  const audienceHours = within(panel).getByRole("spinbutton", {
    name: "通知「通知對象」的時數",
  });
  await user.clear(audienceHours);
  await user.type(audienceHours, "10");
};

describe("流程管理:關卡面板的逾時提醒與知會、整個流程的知會對象", () => {
  it("開啟逾時提醒帶入預設(24 / 48 小時、通知對象 = 有改派權限的人);存草稿帶上", async () => {
    const { user, world } = renderWorkflows();
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    const panel = propertiesPanel();

    await user.click(
      within(panel).getByRole("switch", { name: "開啟逾時提醒" }),
    );
    expect(
      within(panel).getByRole("spinbutton", { name: "通知審核者的時數" }),
    ).toHaveValue(24);
    expect(
      within(panel).getByRole("group", { name: "通知對象條件" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "存草稿" }));

    await waitFor(() => {
      expect(world.inputs.saveDraft).toHaveLength(1);
    });
    expect(world.inputs.saveDraft[0]?.definition.steps[1]?.overdue).toEqual({
      reviewerAfterHours: 24,
      audienceAfterHours: 48,
      audience: DEFAULT_OVERDUE_AUDIENCE,
    });
  });

  it("逾時提醒 M ≤ N → 欄位標紅、擋下不讓存草稿", async () => {
    const { user } = renderWorkflows();
    const canvas = await findCanvas();
    clickNode(canvas, "人資");

    await makeOverdueInvalid(user);

    expect(
      within(propertiesPanel()).getByText(
        "時數要是正整數,而且通知「通知對象」的時數要大於通知審核者的時數。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(BLOCKED)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "存草稿" })).toBeDisabled();
  });

  it("換流程時按「先存草稿」遇到 M ≤ N → 不送出、提示原因、留在原流程", async () => {
    const { user, world } = renderWorkflows({
      world: {
        ...defaultDesignOptions(),
        workflows: [
          workflowFragment(),
          workflowFragment({
            key: "overtime_review",
            name: "加班審核",
            hasDraft: false,
          }),
        ],
      },
    });
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    await makeOverdueInvalid(user);

    const list = screen.getByRole("list", { name: "流程清單" });
    await user.click(within(list).getByText("加班審核"));
    const dialog = await screen.findByRole("dialog", {
      name: "還有沒存的變更",
    });
    await user.click(within(dialog).getByRole("button", { name: "先存草稿" }));

    expect(await findSnackbarAlert()).toEqual({
      severity: "error",
      text: BLOCKED,
    });
    expect(world.inputs.saveDraft).toHaveLength(0);
    expect(
      screen.getByRole("heading", { name: "病假審核" }),
    ).toBeInTheDocument();
  });

  it("關卡的知會預設「不知會」;選主管 → 存草稿帶 cc", async () => {
    const { user, world } = renderWorkflows();
    const canvas = await findCanvas();
    clickNode(canvas, "人資");
    const cc = within(propertiesPanel()).getByRole("group", {
      name: "知會對象",
    });
    const kind = within(cc).getByRole("combobox", { name: "知會對象" });
    expect(kind).toHaveTextContent("不知會");

    await pick(user, kind, "主管");
    await user.click(screen.getByRole("button", { name: "存草稿" }));

    await waitFor(() => {
      expect(world.inputs.saveDraft).toHaveLength(1);
    });
    expect(world.inputs.saveDraft[0]?.definition.steps[1]?.cc).toEqual({
      kind: "manager",
      level: 1,
    });
  });

  it("沒選關卡時是「整個流程」設定:整個流程的知會對象選主管,存草稿帶 definition.cc", async () => {
    const { user, world } = renderWorkflows();
    await findCanvas();
    const flow = within(propertiesPanel()).getByRole("region", {
      name: "整個流程的設定",
    });
    expect(
      within(flow).getByText(/單據完成、被駁回或被作廢時通知/),
    ).toBeInTheDocument();

    await pick(
      user,
      within(flow).getByRole("combobox", { name: "知會對象" }),
      "主管",
    );
    await user.click(screen.getByRole("button", { name: "存草稿" }));

    await waitFor(() => {
      expect(world.inputs.saveDraft).toHaveLength(1);
    });
    expect(world.inputs.saveDraft[0]?.definition.cc).toEqual({
      kind: "manager",
      level: 1,
    });
  });
});
