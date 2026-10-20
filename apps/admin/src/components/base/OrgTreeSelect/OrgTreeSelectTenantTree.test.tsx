import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";

import { api, server } from "@/test/msw/server";
import { toTenantTree } from "@/test/msw/tenant-org-tree";

import {
  demoTree,
  field,
  openPanel,
  renderSelect,
  rowOf,
  treeLabels,
  valueText,
} from "./org-tree-select-test-support";

/**
 * `visible` / `tenant` 模式:樹列**整棵租戶樹**(`tenantOrgTree`),依模式決定哪些能選。
 * 樹的範圍(釘在當前組織的租戶、旗標怎麼算)由 api 的 `orgs/tenant-org-tree.test.ts` 驗。
 * 夾具:示範公司 > 北區(A 店、B 店)、南區(C 店);店長只看得到 A 店。
 */
const STORE_MANAGER_TREE = toTenantTree(demoTree, {
  visibleIds: ["org-a"],
  managedIds: [],
});

/** 樹改查整棵租戶樹;管理範圍的 `orgTree` 也給(不該被用到)。 */
const useTenantTree = () => {
  server.use(
    api.query("TenantOrgTree", () =>
      HttpResponse.json({ data: { tenantOrgTree: STORE_MANAGER_TREE } }),
    ),
  );
};

describe("OrgTreeSelect visible / tenant(整棵租戶樹)", () => {
  it("visible:店長看得到整棵樹,只有自己的分店能選,其他反灰並註明「不在你的可見範圍內」", async () => {
    const { user } = renderSelect({
      scope: "visible",
      disabledReasons: { "org-b": "已由 王小明 對應" },
    });
    useTenantTree();
    await openPanel(user);
    await screen.findByText("A 店");
    // 整棵樹都列出來;標籤後面接的是反灰的原因
    expect(treeLabels()).toEqual([
      "示範公司不在你的可見範圍內",
      "北區不在你的可見範圍內",
      "A 店",
      "B 店已由 王小明 對應",
      "南區不在你的可見範圍內",
      "C 店不在你的可見範圍內",
    ]);

    // 看不到的反灰、有原因;點了不會選
    expect(
      within(rowOf("C 店")).getByText("不在你的可見範圍內"),
    ).toBeInTheDocument();
    await user.click(within(rowOf("C 店")).getByText("C 店"));
    expect(valueText()).toBe("");
    // 底下還有能選的上層(看不到)也選不了,但子孫照樣可以選
    await user.click(within(rowOf("北區")).getAllByText("北區")[0]);
    expect(valueText()).toBe("");
    // 呼叫端的原因照舊疊加(優先)
    expect(
      within(rowOf("B 店")).getByText("已由 王小明 對應"),
    ).toBeInTheDocument();
    // 自己看得到的那家可以選
    expect(within(rowOf("A 店")).queryByText("不在你的可見範圍內")).toBeNull();
  });

  it("visible:可見範圍內的那家選得到", async () => {
    useTenantTree();
    const { user } = renderSelect({ scope: "visible" });
    useTenantTree();
    await openPanel(user);
    await user.click(await screen.findByText("A 店"));
    expect(valueText()).toBe("org-a");
  });

  it("tenant:整個租戶都能選", async () => {
    const { user } = renderSelect({ scope: "tenant" });
    useTenantTree();
    await openPanel(user);
    await screen.findByText("C 店");
    expect(screen.queryByText("不在你的可見範圍內")).toBeNull();
    await user.click(within(rowOf("C 店")).getByText("C 店"));
    expect(valueText()).toBe("org-c");
  });

  it("visible:已選但樹上沒有的組織(別的租戶)顯示「不在你的可見範圍內」", async () => {
    renderSelect({ scope: "visible", initial: ["org-elsewhere"] });
    useTenantTree();
    await waitFor(() => {
      expect(field()).toHaveValue("不在你的可見範圍內");
    });
  });
});
