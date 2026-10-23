import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { dealerFixtures } from "@/test/msw/project/dealers-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import { DEALERS_TEST_ROUTES, renderDealers } from "./dealers-test-support";

setupFakeViewport();

/** 「系統資訊」區塊裡某個欄位(小標 + 值)。 */
const fieldOf = (label: string) => {
  const field = screen.getByText(label).parentElement;
  if (field === null) {
    throw new Error(`找不到欄位:${label}`);
  }
  return within(field);
};

const expandSystem = async (user: ReturnType<typeof renderDealers>["user"]) => {
  // 收合時按鈕名稱 = 標題 + 摘要
  await user.click(await screen.findByRole("button", { name: /^系統資訊/ }));
};

/** 經銷商 / 關係人詳情頁的「系統資訊」區塊(所屬組織、建立、最後修改)。 */
describe("詳情頁的系統資訊", () => {
  it("經銷商:所屬組織、建立時間與建立者、最後修改時間與修改者", async () => {
    const { user } = renderDealers({
      path: `${DEALERS_TEST_ROUTES.viewPage}/dealer-a-1`,
      world: {
        dealers: dealerFixtures.map((dealer) =>
          dealer.id === "dealer-a-1"
            ? { ...dealer, updatedAt: "2026-10-20T06:30:00.000Z" }
            : dealer,
        ),
      },
    });
    await expandSystem(user);

    expect(fieldOf("所屬組織").getByText("總公司")).toBeInTheDocument();
    expect(fieldOf("建立時間").getByText(/2026-09-01/)).toBeInTheDocument();
    expect(fieldOf("建立者").getByText("王總")).toBeInTheDocument();
    expect(fieldOf("最後修改時間").getByText(/2026-10-20/)).toBeInTheDocument();
    expect(fieldOf("修改者").getByText("李店長")).toBeInTheDocument();
  });

  it("關係人:同經銷商的系統資訊", async () => {
    const { user } = renderDealers({
      path: `${DEALERS_TEST_ROUTES.contactViewPage}/contact-1`,
    });
    await expandSystem(user);

    expect(fieldOf("所屬組織").getByText("總公司")).toBeInTheDocument();
    expect(fieldOf("建立者").getByText("王總")).toBeInTheDocument();
    expect(fieldOf("最後修改時間").getByText(/2026-09-01/)).toBeInTheDocument();
    expect(fieldOf("修改者").getByText("李店長")).toBeInTheDocument();
  });
});
