import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  inventoryOrgs,
  sampleBookDetail,
} from "@/test/msw/project/lottery/inventory-fixtures";

import { renderInventory } from "../inventory-test-support";

const BOOK = "/inventory/book-page/b-056527";
const TITLE = "5164 發大財 · 本號 056527";

const grid = () => screen.getAllByRole("group", { name: "張數格子" })[0];

/**
 * 本的詳情:報廢只限拆過的本在庫存的張、撤銷報廢、[更正跳號] 先刷實體再點缺的那張(張數店規格 7.8、7.10,
 * 兩種店共用;Figma IN-03-2a / 2b、IN-04-2b、IN-03-3、IN-04-3a / 3b;驗收 16.6 SC1、SC2、SK1)。
 * 本 056527:#066 在店內櫃台、#088 報廢在庫存、#089–092 未售在庫存、#064 跳號、#037 跳號。
 */
describe("本的詳情:報廢、撤銷報廢、更正跳號", () => {
  it("SC1:檯面上的張 → [報廢] 停用、寫「只能選在庫存的張」;庫存的張可以報廢", async () => {
    const { user } = renderInventory({ path: BOOK });
    await screen.findByRole("heading", { name: TITLE });
    await user.click(within(grid()).getByRole("button", { name: /^#066 / }));
    expect(screen.getByRole("button", { name: "報廢" })).toBeDisabled();
    expect(
      screen.getByText("只能選在庫存的張;檯面上的張請先收回"),
    ).toBeInTheDocument();
    await user.click(within(grid()).getByRole("button", { name: /^#066 / }));
    await user.click(within(grid()).getByRole("button", { name: /^#090 / }));
    expect(screen.getByRole("button", { name: "報廢" })).toBeEnabled();
  });

  it("SC1:從沒拆過的本 → [報廢] 停用、寫「這本還沒拆,請先拆本」(IN-03-2a)", async () => {
    const base = sampleBookDetail();
    const detail = { ...base, book: { ...base.book, state: "unopened" } };
    const { user } = renderInventory({
      path: BOOK,
      world: { details: [detail] },
    });
    await screen.findByRole("heading", { name: TITLE });
    await user.click(within(grid()).getByRole("button", { name: /^#090 / }));
    expect(screen.getByRole("button", { name: "報廢" })).toBeDisabled();
    expect(screen.getByText("這本還沒拆,請先拆本")).toBeInTheDocument();
  });

  it("SC2:選報廢的格子 → [撤銷報廢](原因必填、寫扣回的報廢損失)→ 送出", async () => {
    const { user, fake } = renderInventory({ path: BOOK });
    await screen.findByRole("heading", { name: TITLE });
    await user.click(within(grid()).getByRole("button", { name: /^#088 / }));
    await user.click(screen.getByRole("button", { name: "撤銷報廢" }));
    const dialog = await screen.findByRole("dialog", {
      name: /撤銷報廢 1 張/,
    });
    expect(within(dialog).getByText("扣回報廢損失")).toBeInTheDocument();
    expect(within(dialog).getByText("184 元")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/撤銷後回到未售、位置不變\(中山店 · 庫存\)/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "撤銷報廢" }));
    expect(fake.inputs.undoScrap).toEqual([]);
    await user.click(
      within(dialog).getByRole("combobox", { name: /撤銷原因/ }),
    );
    await user.click(await screen.findByRole("option", { name: "報錯張" }));
    await user.click(within(dialog).getByRole("button", { name: "撤銷報廢" }));
    await waitFor(() => {
      expect(fake.inputs.undoScrap).toEqual([
        {
          tickets: [{ ticketId: "t-088", version: 3 }],
          reasonKey: "mis-scrapped",
          reasonNote: null,
        },
      ]);
    });
  });

  it("SK1:[更正跳號] 先刷實體在手上的那張:刷到的不是跳號 → 當下說明、[更正] 停用;刷到跳號 → 點缺的那張、確認後送出(scanned)", async () => {
    const { user, fake } = renderInventory({ path: BOOK });
    await screen.findByRole("heading", { name: TITLE });
    await user.click(screen.getByRole("button", { name: "更正跳號" }));
    const dialog = await screen.findByRole("dialog", { name: /更正跳號/ });
    const input = within(dialog).getByRole("textbox", {
      name: "① 刷條碼或手輸實體在手上的那張",
    });
    await user.type(input, "056527-070{Enter}");
    expect(
      within(dialog).getByText(
        "#070 現在是未售,不是跳號;請刷記成跳號、但實體在手上的那張",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "更正" })).toBeDisabled();
    await user.clear(input);
    await user.type(input, "056527-064{Enter}");
    const cells = within(dialog).getByRole("group", { name: "張數格子" });
    await user.click(within(cells).getByRole("button", { name: /^#066 / }));
    expect(
      within(dialog).getByText("064 跳號 → 未售,放到 中山店 · 店內櫃台 檯面"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("066 未售 → 跳號")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("combobox", { name: /更正原因/ }),
    );
    await user.click(await screen.findByRole("option", { name: "標註錯誤" }));
    const submit = within(dialog).getByRole("button", { name: "更正" });
    expect(submit).toBeDisabled();
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "我已確認 064 的實體在我手上,066 實際不存在",
      }),
    );
    await user.click(submit);
    await waitFor(() => {
      expect(fake.inputs.swap).toEqual([
        {
          bookId: "b-056527",
          skipped: { ticketId: "t-064", version: 3 },
          unsold: { ticketId: "t-066", version: 3 },
          scanned: true,
          reasonKey: "mark-error",
          reasonNote: null,
        },
      ]);
    });
  });

  it("SK1:記在別店的跳號也可以刷;檯面上別店的張不能選", async () => {
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
      path: BOOK,
      world: { details: [detail] },
    });
    await screen.findByRole("heading", { name: TITLE });
    await user.click(screen.getByRole("button", { name: "更正跳號" }));
    const dialog = await screen.findByRole("dialog", { name: /更正跳號/ });
    await user.type(
      within(dialog).getByRole("textbox", {
        name: "① 刷條碼或手輸實體在手上的那張",
      }),
      "056527-037{Enter}",
    );
    const cells = within(dialog).getByRole("group", { name: "張數格子" });
    expect(
      within(cells).getByRole("button", { name: /^#036 / }),
    ).toBeDisabled();
    await user.click(within(cells).getByRole("button", { name: /^#066 / }));
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(
      within(dialog).getByRole("combobox", { name: /更正原因/ }),
    );
    await user.click(await screen.findByRole("option", { name: "標註錯誤" }));
    await user.click(within(dialog).getByRole("button", { name: "更正" }));
    await waitFor(() => {
      expect(fake.inputs.swap[0]?.skipped.ticketId).toBe("t-037");
    });
  });
});
