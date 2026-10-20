import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";

import { dealerFixtures } from "@/test/msw/project/dealers-fixtures";
import { api, server } from "@/test/msw/server";
import { setupFakeViewport } from "@/test/viewport";

import { DEALERS_TEST_ROUTES, renderDealers } from "../dealers-test-support";

setupFakeViewport();

const EDIT_CHEN = `${DEALERS_TEST_ROUTES.editPage}/dealer-a-1`;

/** 能看、不能改兩個批購基準日(abilities 也跟著 false)。 */
const showOnly = [
  "dealers.create",
  "dealers.edit",
  "dealers.show-last-purchase-base-date",
  "dealers.show-last-self-purchase-base-date",
];

const withoutBaseEdit = dealerFixtures.map((dealer) => ({
  ...dealer,
  abilities: {
    canEdit: true,
    canEditLastPurchaseBaseDate: false,
    canEditLastSelfPurchaseBaseDate: false,
  },
}));

/** 可見範圍組織樹的一個節點(對應分店的候選)。 */
const branch = (id: string, name: string) => ({
  __typename: "OrgNode" as const,
  id,
  name,
  parentId: "org-tenant",
  enabled: true,
  outOfScope: false,
  ownerUserId: null,
  children: [],
});

/** 新增 / 編輯經銷商(Figma DE-03、DE-06b)。 */
describe("經銷商新增 / 編輯頁", () => {
  it("編輯:只送動過的欄位,存完回詳情頁", async () => {
    const { user, fake } = renderDealers({ path: EDIT_CHEN });
    const name = await screen.findByRole("textbox", { name: /姓名/ });

    await user.clear(name);
    await user.type(name, "陳志明二");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.updateLotteryDealer).toEqual([
        { id: "dealer-a-1", name: "陳志明二" },
      ]);
    });
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `${DEALERS_TEST_ROUTES.viewPage}/dealer-a-1`,
      );
    });
  });

  it("欄位級權限:有 show- 沒有 edit- → 批購基準日唯讀並註明,送出時不帶", async () => {
    const { user, fake } = renderDealers({
      path: EDIT_CHEN,
      permissions: showOnly,
      world: { dealers: withoutBaseEdit },
    });
    await screen.findByRole("textbox", { name: /姓名/ });
    expect(screen.getAllByText("沒有修改權限")).toHaveLength(2);

    await user.type(screen.getByRole("textbox", { name: /姓名/ }), "!");
    await user.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => {
      expect(fake.inputs.updateLotteryDealer).toHaveLength(1);
    });
    expect(fake.inputs.updateLotteryDealer[0]).not.toHaveProperty(
      "lastPurchaseBaseDate",
    );
  });

  it("欄位級權限:沒有 show- → 兩個批購基準日整個不顯示", async () => {
    renderDealers({
      path: EDIT_CHEN,
      permissions: ["dealers.edit"],
      world: { dealers: withoutBaseEdit },
    });
    await screen.findByRole("textbox", { name: /姓名/ });
    expect(screen.queryByText("最近一次批購基準日")).not.toBeInTheDocument();
    expect(
      screen.queryByText("最近一次本人批購基準日"),
    ).not.toBeInTheDocument();
  });

  it("移除共同銷售處所但還有代理人:跳確認框列出代理人,確認後一併解除", async () => {
    const { user, fake } = renderDealers({ path: EDIT_CHEN });
    const coSales = await screen.findByRole("combobox", {
      name: "共同銷售處所",
    });
    // MUI 的清除鈕在欄位取得焦點時才出現
    await user.click(coSales);
    await user.click(
      within(
        coSales.closest(".MuiAutocomplete-root") ?? document.body,
      ).getByTitle("Clear"),
    );
    await user.click(screen.getByRole("button", { name: "儲存" }));

    const dialog = await screen.findByRole("dialog", {
      name: "移除共同銷售處所",
    });
    expect(within(dialog).getByText("陳小芳")).toBeInTheDocument();
    expect(within(dialog).getByText("林小玉")).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "一併解除並移除" }),
    );
    await waitFor(() => {
      expect(fake.inputs.updateLotteryDealer.at(-1)).toEqual({
        id: "dealer-a-1",
        coSalesDealerId: null,
        releaseAgents: true,
      });
    });
  });

  it("新增:第一步選類型;選乙類才有店面與牌租區塊,沒選對應分店時提示", async () => {
    server.use(
      api.query("OrgTree", () => HttpResponse.json({ data: { orgTree: [] } })),
    );
    const { user } = renderDealers({ path: DEALERS_TEST_ROUTES.createPage });

    const typeGroup = await screen.findByRole("radiogroup", {
      name: "類型(建立後不能改)",
    });
    expect(
      screen.queryByRole("button", { name: /^店面/ }),
    ).not.toBeInTheDocument();
    await user.click(within(typeGroup).getByRole("radio", { name: "乙類" }));

    expect(
      await screen.findByRole("button", { name: /^店面/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^牌租/ })).toBeInTheDocument();
    expect(
      screen.getByText("還沒有選對應分店:可以先儲存,但請盡快選擇。"),
    ).toBeInTheDocument();
  });

  it("對應分店:候選是可見範圍(visibleOrgTree,不查管理範圍的 orgTree);已對應的分店停用並註明", async () => {
    const calls = { orgTree: 0, visibleOrgTree: 0 };
    server.use(
      api.query("OrgTree", () => {
        calls.orgTree += 1;
        return HttpResponse.json({ data: { orgTree: [] } });
      }),
      api.query("VisibleOrgTree", () => {
        calls.visibleOrgTree += 1;
        return HttpResponse.json({
          data: {
            visibleOrgTree: [
              {
                ...branch("org-tenant", "好運彩券行"),
                parentId: null,
                children: [
                  branch("org-branch-a", "中山店"),
                  branch("org-branch-b", "信義店"),
                ],
              },
            ],
          },
        });
      }),
    );
    const { user } = renderDealers({ path: DEALERS_TEST_ROUTES.createPage });
    const typeGroup = await screen.findByRole("radiogroup", {
      name: "類型(建立後不能改)",
    });
    await user.click(within(typeGroup).getByRole("radio", { name: "乙類" }));

    await user.click(await screen.findByRole("combobox", { name: "對應分店" }));

    expect(
      await screen.findByText("已由 好運 2 號店 對應"),
    ).toBeInTheDocument();
    expect(screen.getByText("信義店")).toBeInTheDocument();
    expect(calls.visibleOrgTree).toBeGreaterThan(0);
    expect(calls.orgTree).toBe(0);
  });
});
