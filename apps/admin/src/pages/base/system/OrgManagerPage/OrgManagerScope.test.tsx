import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { multiRootTree, tenantTree } from "@/test/msw/org-fixtures";

import {
  OWN_PERMISSIONS,
  SET_VISIBILITY_PERMISSION,
  clickNode,
  detail,
  renderPage,
  stubObjectUrl,
  treeItem,
  treeLabel,
  waitForTree,
} from "./org-manager-test-support";

stubObjectUrl();

/**
 * 組織管理頁的**管理範圍**行為(正本 CONTEXT.md「管理範圍」+ ADR-0005 的分工表)。
 * 三種視角是同一支頁面的三組資料:管理範圍是全部 / 擁有組織是租戶頂層 / 擁有組織是兩個部門。
 * 其餘行為(彈窗、上傳、錯誤)在 `OrgManagerPage.test.tsx`,保護與提示在 `OrgManagerGuards.test.tsx`。
 */
describe("組織管理頁:管理範圍與視角(/system/org-manager)", () => {
  it("租戶視角:樹根是租戶頂層、沒有租戶標籤,也沒有開通租戶按鈕", async () => {
    renderPage({
      permissions: OWN_PERMISSIONS,
      world: { orgTree: tenantTree },
    });

    await waitForTree();
    // 樹根是租戶頂層(不是平台根組織),所以它不該掛「租戶」標籤
    await waitFor(() => {
      expect(treeLabel("租戶 A")).toBe("租戶 A");
    });
    expect(
      screen.queryByRole("button", { name: "開通租戶" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "+ 子組織" }),
    ).toBeInTheDocument();
  });

  it("多根樹:兩個樹根都在、共同上層不在樹上、沒有租戶標籤,預設選中第一個根", async () => {
    const { user: actor } = renderPage({
      permissions: OWN_PERMISSIONS,
      world: { orgTree: multiRootTree },
    });

    await waitForTree();
    // 兩棵樹各自完整
    expect(treeLabel("A-1 內容組")).toBe("A-1 內容組");
    expect(treeLabel("A-1-1 編輯組")).toBe("A-1-1 編輯組");
    expect(treeLabel("A-2 台北分店")).toBe("A-2 台北分店停用");
    expect(treeLabel("A-2-1 門市櫃台")).toBe("A-2-1 門市櫃台停用");
    // 管理範圍外的組織不回傳,樹上自然沒有;樹根不是平台根組織 → 沒有「租戶」標籤
    expect(treeItem("租戶 A")).toBeUndefined();
    expect(treeItem("平台根組織")).toBeUndefined();
    // 預設選中第一個根
    expect(
      await within(detail()).findByText("負責食譜內容產出與審核"),
    ).toBeInTheDocument();

    await clickNode(actor, "A-2-1 門市櫃台");
    await waitFor(() => {
      expect(within(detail()).getByText("A-2-1 門市櫃台")).toBeInTheDocument();
    });
  });

  it("多根樹的搬移候選:只給自己那一棵根的子樹,另一個根的子樹不在候選內", async () => {
    const { user: actor } = renderPage({
      permissions: OWN_PERMISSIONS,
      world: { orgTree: multiRootTree },
    });

    await waitForTree();
    await clickNode(actor, "A-1-1 編輯組");
    await actor.click(
      await within(detail()).findByRole("button", { name: "編輯" }),
    );

    await actor.click(await screen.findByLabelText("上層組織(搬移)"));
    const options = screen
      .getAllByRole("option")
      .map((item) => item.textContent);
    // 自己那一棵根可以當上層
    expect(options).toContain("A-1 內容組");
    // 自己不能當自己的上層;另一個根的子樹是另一個角色的地盤,不在這個候選清單裡
    expect(options).not.toContain("A-1 內容組 / A-1-1 編輯組");
    expect(options).not.toContain("A-2 台北分店");
    expect(options).not.toContain("A-2 台北分店 / A-2-1 門市櫃台");
  });

  it("編輯彈窗:只持 set-visibility(沒有 tenant-ops)也看得到開關,但沒有擁有者欄", async () => {
    // 租戶管理員的樣子:組織管理層的權限齊全(含 set-visibility),tenant-ops 一筆都沒有
    const { user: actor, fake } = renderPage({
      permissions: [...OWN_PERMISSIONS, SET_VISIBILITY_PERMISSION],
      world: { orgTree: tenantTree },
    });

    await waitForTree();
    await clickNode(actor, "租戶 A");
    await actor.click(
      await within(detail()).findByRole("button", { name: "編輯" }),
    );

    const visibility = await screen.findByRole("switch");
    expect(screen.queryByLabelText("擁有者")).not.toBeInTheDocument();

    await actor.click(visibility);
    await actor.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.setOrgVisibility).toHaveLength(1);
    });
    expect(fake.inputs.setOrgVisibility[0]).toEqual({
      orgId: "org-tenant-a",
      visibility: "SUBTREE",
    });
  });
});
