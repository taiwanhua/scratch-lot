import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  clickNode,
  detail,
  renderPage,
  treeLabel,
  waitForTree,
} from "./module-manager-test-support";

const moduleSwitch = (name: string) =>
  within(detail()).getByRole("switch", { name: `啟用「${name}」` });

const permissionSwitch = (name: string) =>
  within(detail()).getByRole("switch", { name: `啟用權限「${name}」` });

describe("模組與權限頁:enabled 切換", () => {
  it("停用模組要先確認,確認後送出 mutation 並重新查樹", async () => {
    const { user: actor, fake } = renderPage();

    await waitForTree();
    await clickNode(actor, "使用者管理");
    await within(detail()).findByText("system.user-manager");

    const treeCallsBefore = fake.calls.moduleTree;
    await actor.click(moduleSwitch("使用者管理"));

    // 彈窗的文案要說明會連動整棵子樹(Figma 211:331)
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("停用模組「使用者管理」?")).toBeInTheDocument();
    expect(
      dialog.getByText(/它底下的子模組與權限一併停用/),
    ).toBeInTheDocument();
    // 還沒按確認,什麼都不該送出
    expect(fake.inputs.setModuleEnabled).toHaveLength(0);

    await actor.click(dialog.getByRole("button", { name: "停用" }));

    await waitFor(() => {
      expect(fake.inputs.setModuleEnabled).toHaveLength(1);
    });
    expect(fake.inputs.setModuleEnabled[0]).toEqual({
      id: "m-user",
      enabled: false,
    });
    // invalidate 之後真的重新查了一次樹,而且樹上看得到新狀態
    await waitFor(() => {
      expect(fake.calls.moduleTree).toBeGreaterThan(treeCallsBefore);
    });
    await waitFor(() => {
      expect(treeLabel("使用者管理")).toBe("使用者管理停用");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("啟用模組不需要確認,直接送出", async () => {
    const { user: actor, fake } = renderPage();

    await waitForTree();
    await clickNode(actor, "示範模組2");
    await within(detail()).findByText("demo.sample-two");

    await actor.click(moduleSwitch("示範模組2"));

    await waitFor(() => {
      expect(fake.inputs.setModuleEnabled).toHaveLength(1);
    });
    expect(fake.inputs.setModuleEnabled[0]).toEqual({
      id: "m-two",
      enabled: true,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("權限開關直接送出 SetPermissionEnabled,不經彈窗", async () => {
    const { user: actor, fake } = renderPage();

    await waitForTree();
    await clickNode(actor, "組織管理");
    await within(detail()).findByText("system.org-manager");

    await actor.click(permissionSwitch("檢視組織"));

    await waitFor(() => {
      expect(fake.inputs.setPermissionEnabled).toHaveLength(1);
    });
    expect(fake.inputs.setPermissionEnabled[0]).toEqual({
      id: "perm-system.org-manager-view",
      enabled: false,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // 停用是全域 kill switch,清單上方要先把後果講明
    expect(
      within(detail()).getByText(/所有持有者立即失去它/),
    ).toBeInTheDocument();
  });

  it("自鎖保護:模組與權限自己的開關停用並附說明", async () => {
    const { user: actor } = renderPage();

    await waitForTree();
    await clickNode(actor, "模組與權限");
    await within(detail()).findByText("system.module-manager");

    expect(moduleSwitch("模組與權限")).toBeDisabled();
    expect(permissionSwitch("切換模組 / 權限啟用")).toBeDisabled();

    // 提示改用 @repo/ui 的 Tooltip:停用的開關收不到 hover,
    // 事件載體是 Tooltip 自己包的外層 span
    const hintCarrier = moduleSwitch("模組與權限").closest(
      "span.MuiSwitch-root",
    )?.parentElement;
    if (hintCarrier === undefined || hintCarrier === null) {
      throw new Error("自鎖的開關沒有被 Tooltip 包起來");
    }
    await actor.hover(hintCarrier);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "此模組用於管理模組本身,不可停用",
    );
  });

  it("mutation 失敗時顯示錯誤,彈窗留著讓人重試", async () => {
    const { user: actor, fake } = renderPage({
      world: { failures: { SetModuleEnabled: "FORBIDDEN" } },
    });

    await waitForTree();
    await clickNode(actor, "使用者管理");
    await within(detail()).findByText("system.user-manager");

    await actor.click(moduleSwitch("使用者管理"));
    const dialog = within(await screen.findByRole("dialog"));
    await actor.click(dialog.getByRole("button", { name: "停用" }));

    expect(
      await dialog.findByText("只有根組織能變更模組與權限的啟用狀態。"),
    ).toBeInTheDocument();
    expect(fake.inputs.setModuleEnabled).toHaveLength(1);
  });
});
