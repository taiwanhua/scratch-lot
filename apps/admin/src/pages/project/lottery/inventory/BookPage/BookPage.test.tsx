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
 * 對調跳號、報廢、尋回;沒有權限時看不到按鈕與成本(L588)。
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

  it("沒有 mark-skipped / scrap / show-cost:看不到 [對調跳號…]、成本卡、[報廢];跳號格子不能選", async () => {
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
      screen.queryByRole("button", { name: "對調跳號…" }),
    ).not.toBeInTheDocument();
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

  it("對調跳號:選一格跳號 + 一格未售才能按(其他組合停用並提示);對話框寫出結果、原因「其他」要說明、勾選確認才能 [對調]", async () => {
    const { user, fake } = renderInventory({ path: BOOK });
    await screen.findByRole("heading", { name: "5164 發大財 · 本號 056527" });
    await user.click(within(grid()).getByRole("button", { name: "#064 跳號" }));
    expect(screen.getByRole("button", { name: "對調跳號…" })).toBeDisabled();
    expect(
      screen.getByText("選一格跳號 + 一格未售才能對調"),
    ).toBeInTheDocument();
    await user.click(within(grid()).getByRole("button", { name: /^#066 / }));
    await user.click(screen.getByRole("button", { name: "對調跳號…" }));
    const dialog = await screen.findByRole("dialog", { name: /對調跳號/ });
    expect(
      within(dialog).getByText("064 跳號 → 未售,放到 中山店 · 店內櫃台 檯面"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("066 未售 → 跳號")).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "對調" });
    expect(submit).toBeDisabled();
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "我已確認 064 的實體在我手上,066 實際不存在",
      }),
    );
    await user.click(
      within(dialog).getByRole("combobox", { name: /更正原因/ }),
    );
    await user.click(await screen.findByRole("option", { name: "其他" }));
    await user.click(submit);
    expect(fake.inputs.swap).toEqual([]);
    await user.type(
      within(dialog).getByRole("textbox", { name: /說明/ }),
      "拆本時點錯格",
    );
    await user.click(submit);
    await waitFor(() => {
      expect(fake.inputs.swap).toEqual([
        {
          bookId: "b-056527",
          skipped: { ticketId: "t-064", version: 3 },
          unsold: { ticketId: "t-066", version: 3 },
          reasonKey: "other",
          reasonNote: "拆本時點錯格",
        },
      ]);
    });
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
    // 跳號記在中山店也畫成跳號、能選(對調跳號;跳號不算任何店的庫存)
    expect(
      within(grid()).getByRole("button", { name: "#064 跳號" }),
    ).toBeEnabled();
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
  it("預先選取的別店張不畫成已選;記在別店的跳號可以和自己店的未售對調", async () => {
    // #001–040 在別店(含跳號 #037);#064 跳號在自己店
    const base = sampleBookDetail();
    const detail = {
      ...base,
      tickets: base.tickets.map((ticket) =>
        Number(ticket.ticketNo) <= 40
          ? { ...ticket, operable: false, org: inventoryOrgs.storeB }
          : ticket,
      ),
    };
    const { user, fake } = renderInventory({
      path: `${BOOK}?ticket=036`,
      world: { details: [detail] },
    });
    await screen.findByRole("heading", { name: "5164 發大財 · 本號 056527" });
    const linked = within(grid()).getByRole("button", {
      name: "#036 其他分店",
    });
    expect(linked).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/^已選 /)).not.toBeInTheDocument();
    await user.click(within(grid()).getByRole("button", { name: "#037 跳號" }));
    await user.click(within(grid()).getByRole("button", { name: /^#066 / }));
    await user.click(screen.getByRole("button", { name: "對調跳號…" }));
    const dialog = await screen.findByRole("dialog", { name: /對調跳號/ });
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(
      within(dialog).getByRole("combobox", { name: /更正原因/ }),
    );
    await user.click(await screen.findByRole("option", { name: "標註錯誤" }));
    await user.click(within(dialog).getByRole("button", { name: "對調" }));
    await waitFor(() => {
      expect(fake.inputs.swap[0]?.skipped.ticketId).toBe("t-037");
    });
  });
});
