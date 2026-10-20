import { describe, expect, it } from "@jest/globals";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { dealerFixtures } from "@/test/msw/project/dealers-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import { DEALERS_TEST_ROUTES, renderDealers } from "../dealers-test-support";

setupFakeViewport();

const CHEN = `${DEALERS_TEST_ROUTES.viewPage}/dealer-a-1`;
const STORE_THREE = `${DEALERS_TEST_ROUTES.viewPage}/dealer-b-3`;

const expand = async (
  user: ReturnType<typeof renderDealers>["user"],
  title: string,
) => {
  // 收合時按鈕名稱 = 標題 + 摘要
  await user.click(
    await screen.findByRole("button", { name: new RegExp(`^${title}`) }),
  );
};

/** 經銷商詳情頁(`/dealers/view-page/<id>`;Figma DE-04 / DE-05 / DE-06a)。 */
describe("經銷商詳情頁", () => {
  it("甲類:標頭摘要、[編輯](abilities.canEdit)、見簽紀錄分頁", async () => {
    renderDealers({ path: CHEN });

    expect(
      await screen.findByRole("heading", { name: /陳志明 · 甲類 12345678/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/共同銷售處所:好運 2 號店/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "編輯" })).toBeInTheDocument();
    // 甲類只有一個詳情分頁(批購紀錄由進貨單追加):只剩一個時不顯示分頁籤,直接是內容
    expect(
      await screen.findByRole("heading", { name: "見簽紀錄" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "共同銷售人" }),
    ).not.toBeInTheDocument();
  });

  it("沒有 dealers.edit(abilities.canEdit = false):看不到 [編輯] 與 [登記見簽]", async () => {
    renderDealers({
      path: CHEN,
      permissions: [],
      world: {
        dealers: dealerFixtures.map((dealer) => ({
          ...dealer,
          abilities: {
            canEdit: false,
            canEditLastPurchaseBaseDate: false,
            canEditLastSelfPurchaseBaseDate: false,
          },
        })),
      },
    });
    await screen.findByRole("heading", { name: /陳志明/ });
    expect(
      screen.queryByRole("button", { name: "編輯" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "登記見簽" }),
    ).not.toBeInTheDocument();
  });

  it("欄位級權限:沒有 show- 權限時兩個批購基準日不顯示", async () => {
    const { user } = renderDealers({
      path: CHEN,
      permissions: ["dealers.edit"],
    });
    await expand(user, "經銷商資訊");
    expect(await screen.findByText("證照核准日")).toBeInTheDocument();
    expect(screen.queryByText("最近一次批購基準日")).not.toBeInTheDocument();
    expect(
      screen.queryByText("最近一次本人批購基準日"),
    ).not.toBeInTheDocument();
  });

  it("有 show- 權限:兩個批購基準日顯示", async () => {
    const { user } = renderDealers({ path: CHEN });
    await expand(user, "經銷商資訊");
    expect(await screen.findByText("最近一次批購基準日")).toBeInTheDocument();
    expect(screen.getByText("最近一次本人批購基準日")).toBeInTheDocument();
  });

  it("登記見簽:選季別與見簽日送出,四季狀態跟著更新", async () => {
    const { user, fake } = renderDealers({ path: CHEN });
    await screen.findByRole("heading", { name: /陳志明/ });

    const table = await screen.findByRole("table", { name: "見簽紀錄" });
    expect(await within(table).findByText("未登記")).toBeInTheDocument();
    expect(within(table).getByText("本季未登記")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "登記見簽" }));
    const dialog = await screen.findByRole("dialog");
    const signedAt = within(dialog).getByRole("group", { name: /見簽日/ });
    fireEvent.click(
      within(signedAt.parentElement ?? dialog).getByRole("button", {
        name: /choose date/i,
      }),
    );
    fireEvent.click(await screen.findByRole("gridcell", { name: "2" }));
    await user.click(within(dialog).getByRole("button", { name: "登記" }));

    await waitFor(() => {
      expect(fake.inputs.registerLotteryDealerSignin).toEqual([
        expect.objectContaining({ dealerId: "dealer-a-1", quarter: 4 }),
      ]);
    });
  });

  it("乙類:共同銷售人分頁,超過 6 位只警告", async () => {
    renderDealers({
      path: STORE_THREE,
      world: {
        dealers: [
          ...dealerFixtures,
          ...Array.from({ length: 5 }, (_, index) => ({
            ...dealerFixtures[1],
            id: `dealer-extra-${String(index)}`,
            licenseNo: `9000000${String(index)}`,
          })),
        ],
      },
    });
    expect(
      await screen.findByRole("heading", {
        name: /好運 3 號店 · 乙類 33334444/,
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("共同銷售人 8 位,超過 6 位(只警告)。"),
    ).toBeInTheDocument();
  });
});
