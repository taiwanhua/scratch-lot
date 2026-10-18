import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { tenantTree } from "@/test/msw/org-fixtures";

import {
  OWN_PERMISSIONS,
  SET_VISIBILITY_PERMISSION,
  TENANT_OPS_PERMISSIONS,
  USER_VIEW_PERMISSION,
  clickNode,
  detail,
  renderPage,
  stubObjectUrl,
  waitForTree,
} from "./org-manager-test-support";

stubObjectUrl();

const REVOKE = "撤銷開通";

/** 打開租戶 A 的撤銷開通彈窗。 */
const openDialog = async (actor: { click: (el: Element) => Promise<void> }) => {
  await waitForTree();
  await clickNode(actor, "租戶 A");
  await actor.click(
    await within(detail()).findByRole("button", { name: REVOKE }),
  );
  return screen.getByRole("dialog");
};

/**
 * 撤銷開通(根組織專屬):按鈕的出現條件、確認彈窗的嚴格度、被擋時的原因清單。
 * 與 `OrgManagerPage.test.tsx` 同一頁、同一組夾具,分檔只是為了行數上限(REACT-07)。
 */
describe("組織管理頁:撤銷開通", () => {
  it("彈窗列出會被抹掉的三樣;名稱沒打對按不下去,打對才送出", async () => {
    const { user: actor, fake } = renderPage();

    const dialog = await openDialog(actor);
    // 三樣:租戶名、擁有者帳號、租戶管理員副本名
    expect(within(dialog).getByText("租戶組織「租戶 A」")).toBeInTheDocument();
    expect(
      within(dialog).getByText("擁有者帳號「user-owner」"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("角色副本「預設角色」"),
    ).toBeInTheDocument();

    // 比刪除更嚴格:要照打租戶名稱才按得下去
    const confirm = within(dialog).getByRole("button", { name: REVOKE });
    expect(confirm).toBeDisabled();
    const field =
      within(dialog).getByLabelText("請輸入租戶名稱「租戶 A」以確認");
    await actor.type(field, "租戶 B");
    expect(confirm).toBeDisabled();

    await actor.clear(field);
    await actor.type(field, "租戶 A");
    expect(confirm).toBeEnabled();
    await actor.click(confirm);

    await waitFor(() => {
      expect(fake.inputs.revokeTenantProvision).toEqual([
        { orgId: "org-tenant-a" },
      ]);
    });
  });

  it("被擋時逐項列出原因,並提示改用停用", async () => {
    const { user: actor } = renderPage({
      world: {
        failures: {
          RevokeTenantProvision: {
            code: "PROVISION_NOT_REVOKABLE",
            extensions: { reasons: ["HAS_MEMBERS", "HAS_BUSINESS_DATA"] },
          },
        },
      },
    });

    const dialog = await openDialog(actor);
    await actor.type(
      within(dialog).getByLabelText("請輸入租戶名稱「租戶 A」以確認"),
      "租戶 A",
    );
    await actor.click(within(dialog).getByRole("button", { name: REVOKE }));

    // reasons 與刪除共用同一組語彙(api 也是同一支檢查函式)
    expect(await screen.findByText("還有成員屬於這個組織")).toBeInTheDocument();
    expect(screen.getByText("還有資料掛在它底下")).toBeInTheDocument();
    expect(
      screen.getByText(
        "撤銷只給「開錯了、還沒有人用」的租戶;已經有自己的資料時請改用停用。",
      ),
    ).toBeInTheDocument();
    // 被擋之後不再給「撤銷開通」的送出鈕,只剩關閉
    expect(
      within(screen.getByRole("dialog")).queryByRole("button", {
        name: REVOKE,
      }),
    ).not.toBeInTheDocument();
  });

  it("沒有 revoke-provision 權限:按鈕不出現(ADR-0011 頁內判斷)", async () => {
    const { user: actor } = renderPage({
      permissions: [
        ...OWN_PERMISSIONS,
        SET_VISIBILITY_PERMISSION,
        USER_VIEW_PERMISSION,
      ],
    });

    await waitForTree();
    await clickNode(actor, "租戶 A");
    expect(
      await within(detail()).findByRole("button", { name: "編輯" }),
    ).toBeInTheDocument();
    expect(
      within(detail()).queryByRole("button", { name: REVOKE }),
    ).not.toBeInTheDocument();
  });

  it("選的不是租戶頂層:按鈕不出現(撤銷的對象只有租戶頂層)", async () => {
    const { user: actor } = renderPage();

    await waitForTree();
    // 只點一次:MUI 的樹「點內容區 = 同時選取與收合」,點過租戶 A 之後就找不到它的子節點了
    await clickNode(actor, "A-1 內容組");

    expect(
      await within(detail()).findByRole("button", { name: "編輯" }),
    ).toBeInTheDocument();
    expect(
      within(detail()).queryByRole("button", { name: REVOKE }),
    ).not.toBeInTheDocument();
  });

  it("租戶視角:即使手上有那筆權限也不出現(站在租戶裡撤不了自己)", async () => {
    renderPage({
      permissions: [
        ...OWN_PERMISSIONS,
        ...TENANT_OPS_PERMISSIONS,
        SET_VISIBILITY_PERMISSION,
        USER_VIEW_PERMISSION,
      ],
      world: { orgTree: tenantTree },
    });

    await waitForTree();
    expect(
      await within(detail()).findByRole("button", { name: "編輯" }),
    ).toBeInTheDocument();
    expect(
      within(detail()).queryByRole("button", { name: REVOKE }),
    ).not.toBeInTheDocument();
  });
});
