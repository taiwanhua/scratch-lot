import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { renderInventory } from "../inventory-test-support";

const cards = async () =>
  within(await screen.findByRole("list", { name: "待查·遺失" })).findAllByRole(
    "listitem",
  );

const cardWith = async (title: string) => {
  const items = await cards();
  const card = items.find((item) => within(item).queryByText(title));
  if (card === undefined) {
    throw new Error(`no card: ${title}`);
  }
  return card;
};

/** 待查·遺失在手機寬一列一張卡片(規格 16.0;Figma CS-21 手機 862:22606)。 */
describe("待查·遺失:手機卡片", () => {
  restoreViewportAfterEach();

  it("手機寬:不出表格,一列一張卡片;確定的列有本號 · 遊戲 · 張數、狀態、批購成本與 [尋回]", async () => {
    setMobileViewport();
    const { user } = renderInventory();
    await user.click(await screen.findByRole("tab", { name: "待查·遺失" }));

    expect(await cards()).toHaveLength(4);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    const card = await cardWith("056420 · 5164 發大財 · 10 張");
    expect(within(card).getByText("待查")).toBeInTheDocument();
    expect(within(card).getByText(/^新竹店 · .*T-0007/)).toBeInTheDocument();
    expect(within(card).getByText("批購成本 1,840")).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: "尋回" }),
    ).toBeInTheDocument();
    expect(
      within(await cardWith("060090 · 5201 金好運 · 100 張")).getByText("遺失"),
    ).toBeInTheDocument();
  });

  it("手機寬:未對號的卡片「遊戲 · N 張 · 系統預設帶入」,直接寫本號與張號,沒有 [尋回]", async () => {
    setMobileViewport();
    const { user } = renderInventory();
    await user.click(await screen.findByRole("tab", { name: "待查·遺失" }));

    const card = await cardWith("5164 發大財 · 1 張 · 系統預設帶入");
    expect(
      within(card).getByText("中山店 · 10/16 交班盤點 · 批購成本 184"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        "本號 056527 · #090(系統預設帶入)· 找到實體請刷條碼尋回,或做全店重刷",
      ),
    ).toBeInTheDocument();
    expect(
      within(card).queryByRole("button", { name: "尋回" }),
    ).not.toBeInTheDocument();
  });

  it("手機寬:點 [尋回] 開尋回對話框", async () => {
    setMobileViewport();
    const { user } = renderInventory();
    await user.click(await screen.findByRole("tab", { name: "待查·遺失" }));

    const card = await cardWith("056420 · 5164 發大財 · 10 張");
    await user.click(within(card).getByRole("button", { name: "尋回" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
