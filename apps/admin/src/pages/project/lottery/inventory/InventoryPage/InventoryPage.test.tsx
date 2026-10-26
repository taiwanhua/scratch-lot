import { describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";

import { INVENTORY_PERMISSIONS as P } from "@repo/domain/project/lottery";

import { RecoverTicketDialog } from "@/components/project/lottery/RecoverTicketDialog/RecoverTicketDialog";
import { api, server } from "@/test/msw/server";

import { renderInventory } from "../inventory-test-support";

/** 刷到實體的尋回(店面看板刷到一張待查;不給 `store` → 目前組織是店就回到它,否則選回到哪家店)。 */
const ScannedRecover = () => (
  <RecoverTicketDialog
    book={{
      gameCode: "5164",
      gameName: "發大財",
      unitPrice: 200,
      bookNo: "0056527",
    }}
    tickets={[
      { id: "t-071", version: 3, ticketNo: "071", status: "investigating" },
    ]}
    onClose={jest.fn()}
  />
);

/**
 * 庫存管理(規格 7.3、7.4、7.6;Figma IN-01、IN-02、IN-05、IN-06):三個分頁、查刮刮樂、
 * 預計要給本數唯讀 / 可改(看 api 的 `canEdit`)、待查·遺失 [尋回](看 `canRecover`)。
 */
describe("庫存管理:分頁、查刮刮樂、預計要給本數", () => {
  it("庫存分頁:以本為單位(拆開的本顯示各分店張數、待標註標籤)", async () => {
    renderInventory();
    expect(
      await screen.findByRole("tab", { name: "庫存" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "待查·遺失" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "預計要給本數" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("056527")).toBeInTheDocument();
    expect(screen.getByText("中山店 70 / 新竹店 30")).toBeInTheDocument();
    expect(screen.getByText("35 / 100")).toBeInTheDocument();
    expect(screen.getAllByText("陳志明 #12345678")).toHaveLength(2);
    expect(screen.getByText("共 4 本")).toBeInTheDocument();
  });

  it("查刮刮樂:輸入背面編號 → 顯示那一張 → [查詢] 跳到那一本並標亮", async () => {
    const { user } = renderInventory();
    await user.click(await screen.findByRole("button", { name: "查刮刮樂" }));
    const dialog = await screen.findByRole("dialog", { name: "查刮刮樂" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "刷條碼或輸入背面編號" }),
      "5164-1-056527-071-0-6",
    );
    expect(
      await within(dialog).findByText(
        "本號 056527 · 張號 071 · 待查 · 責任分店 中山店",
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "查詢" }));
    expect(
      await screen.findByRole("heading", { name: "5164 發大財 · 本號 056527" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("已選 1 張 #071")).toBeInTheDocument();
  });

  it("預計要給本數:每格「已給 / 預計」,超過預計警告;有 edit-allocations 點格子修改", async () => {
    const { user, fake } = renderInventory();
    await user.click(await screen.findByRole("tab", { name: "預計要給本數" }));
    expect(await screen.findByText("12 / 10")).toBeInTheDocument();
    expect(screen.getByText("3 +30 張 / 5")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "修改 中山店 5164 發大財 的預計要給本數",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "預計要給本數" });
    const field = within(dialog).getByRole("textbox", { name: /預計要給本數/ });
    await user.clear(field);
    await user.type(field, "9");
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(fake.inputs.allocation).toEqual([
        {
          orgId: "org-store-a",
          gameId: "g-5164",
          plannedBooks: 9,
          note: null,
        },
      ]);
    });
  });

  it("沒有 edit-allocations:預計要給本數唯讀(沒有可點的格子)", async () => {
    const { user } = renderInventory({
      permissions: [P.markSkipped, P.recover, P.scrap, P.showCost],
    });
    await user.click(await screen.findByRole("tab", { name: "預計要給本數" }));
    expect(await screen.findByText("12 / 10")).toBeInTheDocument();
    expect(screen.getByText("每格「已給 / 預計」。")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /的預計要給本數$/ }),
    ).not.toBeInTheDocument();
  });

  it("待查·遺失:列出本、責任分店、批購成本;[尋回] 不換店、回到張所在分店的庫存(原因必填)", async () => {
    const { user, fake } = renderInventory();
    await user.click(await screen.findByRole("tab", { name: "待查·遺失" }));
    expect(await screen.findByText("056420")).toBeInTheDocument();
    expect(screen.getByText("18,400")).toBeInTheDocument();
    const [recover] = screen.getAllByRole("button", { name: "尋回" });
    await user.click(recover);
    const dialog = await screen.findByRole("dialog", { name: "尋回 10 張" });
    expect(within(dialog).getByText("中山店 庫存")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "尋回" }));
    expect(fake.inputs.recover).toEqual([]);
    await user.click(
      within(dialog).getByRole("combobox", { name: /尋回原因/ }),
    );
    await user.click(await screen.findByRole("option", { name: "店內找到" }));
    await user.click(within(dialog).getByRole("button", { name: "尋回" }));
    await waitFor(() => {
      expect(fake.inputs.recover).toHaveLength(1);
    });
    expect(fake.inputs.recover[0]).toMatchObject({
      reasonKey: "found-in-store",
      reasonNote: null,
    });
    // 從清單選:不送 orgId(api 不換店)
    expect(fake.inputs.recover[0]?.orgId).toBeUndefined();
  });

  it("待查·遺失查詢失敗:顯示載入失敗提示,不是靜默空白", async () => {
    const { user } = renderInventory();
    server.use(
      api.query("LotteryInvestigations", () =>
        HttpResponse.json({ errors: [{ message: "boom" }] }),
      ),
    );
    await user.click(await screen.findByRole("tab", { name: "待查·遺失" }));
    expect(
      await screen.findByText("待查·遺失清單載入失敗,請稍後再試"),
    ).toBeInTheDocument();
  });

  it("沒有 recover / show-cost:待查·遺失沒有 [尋回]、沒有批購成本欄", async () => {
    const { user } = renderInventory({ permissions: [] });
    await user.click(await screen.findByRole("tab", { name: "待查·遺失" }));
    expect(await screen.findByText("056420")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "尋回" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("批購成本")).not.toBeInTheDocument();
  });

  it("刷到實體(店面看板)、目前組織不是店:尋回要選「回到哪家店」(只列看得到的店)", async () => {
    const { user, fake } = renderInventory({
      world: { stores: [{ id: "org-store-b", name: "新竹店" }] },
      extra: <ScannedRecover />,
    });
    const dialog = await screen.findByRole("dialog", { name: "尋回 1 張" });
    await user.click(
      within(dialog).getByRole("combobox", { name: /尋回原因/ }),
    );
    await user.click(await screen.findByRole("option", { name: "店內找到" }));
    await user.click(within(dialog).getByRole("button", { name: "尋回" }));
    expect(fake.inputs.recover).toEqual([]);
    await user.click(
      within(dialog).getByRole("combobox", { name: /回到哪家店/ }),
    );
    await user.click(await screen.findByRole("option", { name: "新竹店" }));
    await user.click(within(dialog).getByRole("button", { name: "尋回" }));
    await waitFor(() => {
      expect(fake.inputs.recover[0]).toMatchObject({ orgId: "org-store-b" });
    });
  });

  it("遊戲詳情:綁了庫存管理才有「庫存概況」「預計要給本數」分頁", async () => {
    renderInventory({
      path: "/master-data/game-view-page/g-5164",
      masterData: true,
    });
    expect(
      await screen.findByRole("tab", { name: "庫存概況" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "預計要給本數" }),
    ).toBeInTheDocument();
  });

  it("遊戲詳情:沒綁庫存管理 → 沒有庫存的兩個分頁", async () => {
    renderInventory({
      path: "/master-data/game-view-page/g-5164",
      masterData: true,
      inventory: false,
    });
    // 只剩基本資料一個分頁時不顯示分頁籤
    expect(await screen.findAllByText(/發大財/)).not.toHaveLength(0);
    expect(
      screen.queryByRole("tab", { name: "庫存概況" }),
    ).not.toBeInTheDocument();
  });
});
