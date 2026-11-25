import { beforeEach, describe, expect, it } from "@jest/globals";
import { act, screen, waitFor, within } from "@testing-library/react";

import { INVENTORY_PERMISSIONS } from "@repo/domain/project/lottery";

import { injectScan } from "@/hooks/base/useScanner/scanner-registry";
import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";
import { STORE_ALL_PERMISSIONS } from "@/test/msw/project/lottery/store-fixtures";

import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";

/** 等看板載好再刷(看板頁宣告掃描用途後才會交給銷售)。 */
const scan = async (code: string) => {
  await screen.findByRole("heading", { name: "店內櫃台" });
  act(() => {
    injectScan(code);
  });
};

/** 店面管理 → 銷售:刷到期初已售(導入前已賣出;期初建檔規格 4.2、D6)。 */
describe("店面管理:刷到期初已售", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    writeLocalCashPoint(STORE_A, "cp-counter");
  });

  it("刷到期初已售 → 「導入前已賣出,請用期初更正」;有 inventory.opening 附 [期初更正],預設放刷到的位置", async () => {
    const { user, salesFake, opening } = renderStore({
      permissions: [...STORE_ALL_PERMISSIONS, INVENTORY_PERMISSIONS.opening],
      sales: { openingSoldTicketIds: ["b-1-t99"] },
    });
    await scan("0056527099");
    const blocked = await screen.findByRole("dialog", { name: "不能銷售" });
    expect(
      within(blocked).getByText("這張刮刮樂導入前已賣出,請用期初更正。"),
    ).toBeInTheDocument();
    expect(salesFake.inputs.sell).toEqual([]);
    await user.click(within(blocked).getByRole("button", { name: "期初更正" }));
    const dialog = await screen.findByRole("dialog", {
      name: /改回未售 1 張/u,
    });
    await waitFor(() => {
      expect(
        within(dialog).getByRole("combobox", { name: "放到" }),
      ).toHaveTextContent("檯面 · 店內櫃台");
    });
    await user.click(within(dialog).getByRole("combobox", { name: /原因/u }));
    await user.click(await screen.findByRole("option", { name: "建檔點錯" }));
    await user.click(within(dialog).getByRole("button", { name: "改回未售" }));
    await waitFor(() => {
      expect(opening.inputs.fix).toHaveLength(1);
    });
    expect(opening.inputs.fix[0]).toMatchObject({
      to: "unsold",
      cashPointId: "cp-counter",
      tickets: [{ ticketId: "b-1-t99", version: 3 }],
    });
  });

  it("刷到期初已售、沒有 inventory.opening → 只有 [知道了]", async () => {
    renderStore({ sales: { openingSoldTicketIds: ["b-1-t99"] } });
    await scan("0056527099");
    const blocked = await screen.findByRole("dialog", { name: "不能銷售" });
    expect(
      within(blocked).getByText("這張刮刮樂導入前已賣出,請用期初更正。"),
    ).toBeInTheDocument();
    expect(
      within(blocked).queryByRole("button", { name: "期初更正" }),
    ).not.toBeInTheDocument();
  });

  it("撤銷售出申請新增頁刷到期初已售 → 不能加入,「導入前已賣出,不能撤銷,請用期初更正」(兩種店)", async () => {
    for (const countMode of ["numbered", "count"] as const) {
      const { user, unmount } = renderStore({
        path: `/store/create-page/sale_reversal?org=${STORE_A}`,
        forms: { countMode },
        sales: { openingSoldTicketIds: ["b-1-t70"] },
      });
      const input = await screen.findByRole("textbox", {
        name: "刷條碼加入張數",
      });
      await user.type(input, "056527-070{Enter}");
      expect(
        await screen.findByText("這張刮刮樂導入前已賣出,不能撤銷,請用期初更正"),
      ).toBeInTheDocument();
      expect(screen.queryByText(/#070(刷條碼加入)/u)).toBeNull();
      unmount();
    }
  });
});
