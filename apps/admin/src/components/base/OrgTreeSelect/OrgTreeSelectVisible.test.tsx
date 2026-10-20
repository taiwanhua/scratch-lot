import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse } from "msw";

import { api, server } from "@/test/msw/server";

import {
  demoTree,
  field,
  node,
  openPanel,
  renderSelect,
  treeLabels,
} from "./org-tree-select-test-support";

/**
 * `scope="visible"`(業務頁):候選改查 `visibleOrgTree`(可見範圍),不打管理範圍的 `orgTree`。
 * 範圍本身(店長只看得到自己的分店、總部看得到整個租戶、不出現別的租戶、不要治理權限)
 * 由 api 的 `orgs/visible-org-tree.test.ts` 驗。
 */
describe("OrgTreeSelect scope=visible", () => {
  it("候選來自 visibleOrgTree,不打 orgTree;範圍外的已選值顯示「不在你的可見範圍內」", async () => {
    let managedCalls = 0;
    const { user } = renderSelect(
      { scope: "visible", initial: ["org-elsewhere"] },
      () => {
        managedCalls += 1;
        return HttpResponse.json({ data: { orgTree: demoTree } });
      },
    );
    server.use(
      api.query("VisibleOrgTree", () =>
        HttpResponse.json({
          data: { visibleOrgTree: [node("org-a", "A 店", null)] },
        }),
      ),
    );
    await waitFor(() => {
      expect(field()).toHaveValue("不在你的可見範圍內");
    });
    await openPanel(user);
    await screen.findByText("A 店");
    expect(treeLabels()).toEqual(["A 店"]);
    expect(managedCalls).toBe(0);
  });
});
