import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { INVENTORY_PERMISSIONS as P } from "@repo/domain/project/lottery";

import {
  inventoryOrgs,
  sampleBookDetail,
} from "@/test/msw/project/lottery/inventory-fixtures";

import { renderInventory } from "../inventory-test-support";

const BOOK = "/inventory/book-page/b-056527";

const grid = () => screen.getByRole("group", { name: "張數格子" });

/**
 * 本的詳情(規格 7.3、7.4;Figma IN-03、IN-04a/b/c):來源 / 所在 / 成本、格子與選張操作列、
 * 報廢、尋回;沒有權限時看不到按鈕與成本(L588)。更正跳號、報廢只限庫存、撤銷報廢見 `BookPageCorrections.test.tsx`。
 */
describe("本的詳情", () => {
  it("頁首、來源、所在、成本與事件時間軸", async () => {
    renderInventory({ path: BOOK });
    expect(
      await screen.findByRole("heading", { name: "5164 發大財 · 本號 056527" }),
    ).toBeInTheDocument();
    expect(screen.getByText("200 元 · 張號 001–102")).toBeInTheDocument();
    expect(screen.getByText("P-1016(10/12)")).toBeInTheDocument();
    expect(screen.getByText("中山店 · 店外攤位")).toBeInTheDocument();
    expect(screen.getByText("18,400 / 184")).toBeInTheDocument();
    expect(screen.getByText("#041–065")).toBeInTheDocument();
    expect(screen.getByText("店內櫃台 → 店外攤位")).toBeInTheDocument();
    expect(screen.getByText("整本")).toBeInTheDocument();
    // 跨班撤銷:標「前期更正,屬於 X 班」
    expect(
      screen.getByText("撤銷(前期更正,屬於 店外攤位 · 李小華 10/15 13:00)"),
    ).toBeInTheDocument();
  });

  it("沒有 mark-skipped / scrap / show-cost:看不到 [更正跳號]、成本卡、[報廢];跳號格子不能選", async () => {
    const { user } = renderInventory({ path: BOOK, permissions: [P.recover] });
    expect(
      await screen.findByRole("heading", { name: "5164 發大財 · 本號 056527" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("成本")).not.toBeInTheDocument();
    expect(
      within(grid()).getByRole("button", { name: "#064 跳號" }),
    ).toBeDisabled();
    await user.click(within(grid()).getByRole("button", { name: /^#090 / }));
    expect(await screen.findByText("已選 1 張 #090")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "報廢" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "更正跳號" }),
    ).not.toBeInTheDocument();
  });

  it("已批售(IN-03-4a):標籤、來源批售單、所在、時間軸寫買方", async () => {
    const base = sampleBookDetail();
    const [source] = base.sources;
    const [event] = base.events;
    renderInventory({
      path: BOOK,
      world: {
        details: [
          {
            ...base,
            book: {
              ...base.book,
              state: "wholesaled",
              wholesaleCustomerName: "好運彩券行",
            },
            tickets: base.tickets.map((ticket) => ({
              ...ticket,
              status: "wholesaled",
            })),
            locations: [],
            sources: [
              source,
              {
                ...source,
                type: "wholesale",
                refId: "w-1",
                refSerialNo: "W-0001",
                at: "2026-11-19T02:45:00.000Z",
                wholesaleState: "shipped",
                customerName: "好運彩券行",
              },
            ],
            events: [
              {
                ...event,
                type: "wholesale_void",
                correctionOfShift: null,
                wholeBook: true,
                ticketNos: base.tickets.map((ticket) => ticket.ticketNo),
                to: { ...event.to, locationKind: "stock", cashPoint: null },
                refSerialNo: "W-0001",
                reasonKey: "input-error",
                reasonNote: null,
                voidReasonLabel: "登記錯誤",
                customerName: "好運彩券行",
              },
            ],
          },
        ],
      },
    });
    await screen.findByRole("heading", { name: "5164 發大財 · 本號 056527" });
    // 標籤、圖例、格子都寫「已批售」
    expect(screen.getAllByText("已批售").length).toBeGreaterThan(0);
    expect(
      screen.getByText("W-0001(11/19 出貨 · 好運彩券行)"),
    ).toBeInTheDocument();
    expect(screen.getByText("好運彩券行(已批售)")).toBeInTheDocument();
    expect(screen.getByText("取消批售")).toBeInTheDocument();
    expect(
      screen.getByText("批售單 W-0001 作廢(登記錯誤)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^好運彩券行 → .+ 庫存$/)).toBeInTheDocument();
    expect(
      within(grid()).getByRole("button", { name: /^#001 已批售/ }),
    ).toBeDisabled();
  });

  it("批售中(IN-03-4b / CS-20-2b):標籤、來源寫審核中、格子不能選;張數店寫剩 N 張不能賣", async () => {
    const base = sampleBookDetail();
    const [source] = base.sources;
    renderInventory({
      path: BOOK,
      world: {
        details: [
          {
            ...base,
            countStore: true,
            tickets: base.tickets.map((ticket) => ({
              ...ticket,
              status: "unsold",
              locked: true,
              lockRefType: "wholesale",
            })),
            sources: [
              source,
              {
                ...source,
                type: "wholesale",
                refId: "w-1",
                refSerialNo: "W-0001",
                at: null,
                wholesaleState: "reviewing",
              },
            ],
          },
        ],
      },
    });
    await screen.findByRole("heading", { name: "5164 發大財 · 本號 056527" });
    expect(screen.getByText("W-0001(審核中)")).toBeInTheDocument();
    expect(screen.getByText(/張\(批售中,不能賣\)/)).toBeInTheDocument();
    expect(
      within(grid()).getByRole("button", { name: /^#001 批售中/ }),
    ).toBeDisabled();
  });

  it("選未售的張 → [報廢](原因必填)→ 送出", async () => {
    const { user, fake } = renderInventory({ path: BOOK });
    await screen.findByRole("heading", { name: "5164 發大財 · 本號 056527" });
    await user.click(within(grid()).getByRole("button", { name: /^#090 / }));
    await user.click(within(grid()).getByRole("button", { name: /^#091 / }));
    await user.click(screen.getByRole("button", { name: "報廢" }));
    const dialog = await screen.findByRole("dialog", { name: /報廢 2 張/ });
    expect(within(dialog).getByText("368 元")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("combobox", { name: /報廢原因/ }),
    );
    await user.click(await screen.findByRole("option", { name: "受潮" }));
    await user.click(within(dialog).getByRole("button", { name: "報廢" }));
    await waitFor(() => {
      expect(fake.inputs.scrap).toEqual([
        {
          tickets: [
            { ticketId: "t-090", version: 3 },
            { ticketId: "t-091", version: 3 },
          ],
          reasonKey: "damp",
          reasonNote: null,
        },
      ]);
    });
  });

  it("選待查的張 → [尋回];選到未售與待查混在一起 → 沒有共同按鈕", async () => {
    const { user } = renderInventory({ path: BOOK });
    await screen.findByRole("heading", { name: "5164 發大財 · 本號 056527" });
    await user.click(within(grid()).getByRole("button", { name: /^#071 / }));
    expect(screen.getByRole("button", { name: "尋回" })).toBeInTheDocument();
    await user.click(within(grid()).getByRole("button", { name: /^#072 / }));
    expect(
      screen.queryByRole("button", { name: "尋回" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "報廢" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "取消選取" }),
    ).toBeInTheDocument();
  });

  it("整本待查:頁首狀態列 + [整本尋回]", async () => {
    const { user } = renderInventory({
      path: "/inventory/book-page/b-056420",
    });
    expect(
      await screen.findByText("這本待查中:10/12 T-0007,責任分店 = 中山店"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "整本尋回" }));
    expect(
      await screen.findByRole("dialog", { name: "尋回 100 張" }),
    ).toBeInTheDocument();
  });
  it("別店的張:灰色「其他分店」、不能選(圖例同步);自己店的待查張尋回不換店(不送 orgId)", async () => {
    // 收貨店(新竹店)的視角:#001–070 留在中山店(看得到、不能操作),#071 起在新竹店
    const base = sampleBookDetail();
    const detail = {
      ...base,
      tickets: base.tickets.map((ticket) =>
        Number(ticket.ticketNo) <= 70
          ? { ...ticket, operable: false }
          : { ...ticket, org: inventoryOrgs.storeB },
      ),
    };
    const { user, fake } = renderInventory({
      path: BOOK,
      world: { details: [detail] },
    });
    await screen.findByRole("heading", { name: "5164 發大財 · 本號 056527" });
    const other = within(grid()).getByRole("button", { name: "#066 其他分店" });
    expect(other).toBeDisabled();
    expect(
      within(screen.getByRole("list", { name: "格子圖例" })).getByText(
        "其他分店",
      ),
    ).toBeInTheDocument();
    // 跳號記在中山店也畫成跳號;格子不再選跳號(更正跳號改在 [更正跳號] 視窗先刷實體,張數店規格 7.10)
    expect(
      within(grid()).getByRole("button", { name: "#064 跳號" }),
    ).toBeDisabled();
    await user.click(within(grid()).getByRole("button", { name: /^#071 / }));
    await user.click(screen.getByRole("button", { name: "尋回" }));
    const dialog = await screen.findByRole("dialog", { name: "尋回 1 張" });
    expect(within(dialog).getByText("新竹店 庫存")).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("combobox", { name: /回到哪家店/ }),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("combobox", { name: /尋回原因/ }),
    );
    await user.click(await screen.findByRole("option", { name: "店內找到" }));
    await user.click(within(dialog).getByRole("button", { name: "尋回" }));
    await waitFor(() => {
      expect(fake.inputs.recover).toHaveLength(1);
    });
    expect(fake.inputs.recover[0]?.orgId).toBeUndefined();
  });
});
