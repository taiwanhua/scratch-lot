import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { INVENTORY_PERMISSIONS as P } from "@repo/domain/project/lottery";

import {
  ALL_INVENTORY_PERMISSIONS,
  inventoryOrgs,
  sampleBookDetail,
} from "@/test/msw/project/lottery/inventory-fixtures";

import { renderInventory } from "../inventory-test-support";

const BOOK = "/inventory/book-page/b-056527";
const TITLE = "5164 發大財 · 本號 056527";

const grid = () => screen.getAllByRole("group", { name: "張數格子" })[0];

/** 本 056527 改成期初建檔的本:#001–003 導入前已賣出。 */
const openingDetail = () => {
  const base = sampleBookDetail();
  return {
    ...base,
    book: {
      ...base.book,
      source: "opening",
      openingAt: "2026-11-25T01:12:00.000Z",
      openedBy: {
        __typename: "LotteryInventoryRef" as const,
        id: "u-1",
        name: "王店長",
      },
    },
    sources: [],
    tickets: base.tickets.map((ticket) =>
      ["001", "002", "003"].includes(ticket.ticketNo)
        ? { ...ticket, status: "sold", openingSold: true }
        : ticket,
    ),
  };
};

const permissions = [...ALL_INVENTORY_PERMISSIONS, P.opening];

/**
 * 本的詳情的期初建檔(Figma IN-03-5a / 5b、IN-04-5a / 5b;期初建檔規格 4.1、5.3):來源卡、批購金額率標「期初建檔帶入」、
 * 圖例「已售(含導入前已賣出)」、選導入前已賣出 → [改回未售…];選未售 → [改成導入前已賣出…](分店還在建檔)。
 */
describe("本的詳情:期初建檔", () => {
  it("來源卡寫建檔人與時間、批購金額率標「期初建檔帶入」、圖例寫「已售(含導入前已賣出)」", async () => {
    renderInventory({
      path: BOOK,
      permissions,
      world: { details: [openingDetail()] },
    });
    await screen.findByRole("heading", { name: TITLE });
    expect(screen.getByText("王店長 · 11/25 09:12")).toBeInTheDocument();
    expect(screen.getByText(/期初建檔帶入/u)).toBeInTheDocument();
    expect(screen.getByText("已售(含導入前已賣出)")).toBeInTheDocument();
  });

  it("[改回未售…]:選位置、原因必填,送出 to = unsold 與收銀點", async () => {
    const { user, opening } = renderInventory({
      path: BOOK,
      permissions,
      world: { details: [openingDetail()] },
    });
    await screen.findByRole("heading", { name: TITLE });
    await user.click(within(grid()).getByRole("button", { name: /^#002 / }));
    await user.click(screen.getByRole("button", { name: "改回未售…" }));
    const dialog = await screen.findByRole("dialog", {
      name: /改回未售 1 張/u,
    });
    await user.click(within(dialog).getByRole("combobox", { name: "放到" }));
    await user.click(
      await screen.findByRole("option", { name: "檯面 · 店內櫃台" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "改回未售" }));
    expect(opening.inputs.fix).toEqual([]);
    await user.click(within(dialog).getByRole("combobox", { name: /原因/u }));
    await user.click(await screen.findByRole("option", { name: "建檔點錯" }));
    await user.click(within(dialog).getByRole("button", { name: "改回未售" }));
    await waitFor(() => {
      expect(opening.inputs.fix).toHaveLength(1);
    });
    expect(opening.inputs.fix[0]).toMatchObject({
      to: "unsold",
      cashPointId: "cp-counter",
      reasonKey: "miscount",
      tickets: [{ ticketId: "t-002" }],
    });
  });

  it("選未售:分店還在建檔 → [改成導入前已賣出…]", async () => {
    const { user } = renderInventory({
      path: BOOK,
      permissions,
      world: { details: [openingDetail()] },
    });
    await screen.findByRole("heading", { name: TITLE });
    await user.click(within(grid()).getByRole("button", { name: /^#090 / }));
    expect(
      await screen.findByRole("button", { name: "改成導入前已賣出…" }),
    ).toBeInTheDocument();
  });

  it("分店已結束:選未售沒有 [改成導入前已賣出…]", async () => {
    const { user } = renderInventory({
      path: BOOK,
      permissions,
      world: { details: [openingDetail()] },
      openings: {
        [inventoryOrgs.storeA.id]: {
          bookCount: 1,
          closedAt: "2026-11-30T02:00:00.000Z",
          closedBy: "王總部",
        },
      },
    });
    await screen.findByRole("heading", { name: TITLE });
    await user.click(within(grid()).getByRole("button", { name: /^#090 / }));
    expect(screen.getByRole("button", { name: "報廢" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "改成導入前已賣出…" }),
    ).not.toBeInTheDocument();
  });

  it("沒有 inventory.opening:導入前已賣出的格子不能選", async () => {
    renderInventory({
      path: BOOK,
      world: { details: [openingDetail()] },
      permissions: ALL_INVENTORY_PERMISSIONS.filter((key) => key !== P.opening),
    });
    await screen.findByRole("heading", { name: TITLE });
    expect(
      within(grid()).getByRole("button", { name: /^#002 / }),
    ).toBeDisabled();
  });
});
