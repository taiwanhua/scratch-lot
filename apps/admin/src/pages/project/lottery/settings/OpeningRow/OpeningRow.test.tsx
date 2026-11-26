import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { LOTTERY_SETTINGS_PERMISSIONS as P } from "@repo/domain/project/lottery-settings";

import { lotterySettingsOrgs } from "@/test/msw/project/lottery/lottery-settings-fixtures";

import { renderLotterySettings } from "../lottery-settings-test-support";

const { tenant, zhongshan } = lotterySettingsOrgs;

const openingRow = async (): Promise<HTMLElement> => {
  await screen.findByText("期初建檔");
  const row = document.querySelector<HTMLElement>(
    '[data-setting-key="opening"]',
  );
  if (row === null) {
    throw new TypeError("找不到期初建檔那一列");
  }
  return row;
};

/** 刮刮樂設定的期初建檔那一列:走正式的頁面登記、路由與殼,只有 api 是假的。 */
describe("期初建檔那一列(CS-50a-x、CS-50i、CS-50j;期初建檔規格 6)", () => {
  it("進行中(已建 N 本)+ [結束期初建檔]:確認框寫出後果,送出後變「已結束」+ [重新開放]", async () => {
    const { user, opening } = renderLotterySettings({
      openings: { [zhongshan.id]: { bookCount: 2 } },
    });
    const row = await openingRow();
    expect(within(row).getAllByText("進行中(已建 2 本)")).not.toHaveLength(0);
    await user.click(within(row).getByRole("button", { name: "結束期初建檔" }));
    const dialog = await screen.findByRole("dialog", {
      name: "結束中山店的期初建檔?",
    });
    expect(
      within(dialog).getByText(
        "結束後這家店不能再建檔,之後進來的貨一律用進貨單。已建 2 本。",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "結束期初建檔" }),
    );
    await waitFor(() => {
      expect(opening.inputs.close).toEqual([zhongshan.id]);
    });
    const closed = await openingRow();
    expect(
      await within(closed).findAllByText("已結束(11/30 王總部)"),
    ).not.toHaveLength(0);
    expect(
      within(closed).getByRole("button", { name: "重新開放" }),
    ).toBeInTheDocument();
  });

  it("[重新開放] 原因必填(E1)", async () => {
    const { user, opening } = renderLotterySettings({
      openings: {
        [zhongshan.id]: {
          bookCount: 2,
          closedAt: "2026-11-30T02:00:00.000Z",
          closedBy: "王總部",
        },
      },
    });
    const row = await openingRow();
    await user.click(within(row).getByRole("button", { name: "重新開放" }));
    const dialog = await screen.findByRole("dialog", {
      name: "重新開放中山店的期初建檔?",
    });
    await user.click(within(dialog).getByRole("button", { name: "重新開放" }));
    expect(within(dialog).getByText("請填原因")).toBeInTheDocument();
    expect(opening.inputs.reopen).toEqual([]);
    await user.type(
      within(dialog).getByRole("textbox", { name: /原因/u }),
      "漏建一箱",
    );
    await user.click(within(dialog).getByRole("button", { name: "重新開放" }));
    await waitFor(() => {
      expect(opening.inputs.reopen).toEqual([
        { orgId: zhongshan.id, reason: "漏建一箱" },
      ]);
    });
  });

  it("店長(view + 期初建檔)只能看:沒有按鈕", async () => {
    renderLotterySettings({
      permissions: [P.view, "inventory.opening"],
      openings: { [zhongshan.id]: { bookCount: 1 } },
    });
    const row = await openingRow();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });

  it("最上層組織:不顯示期初建檔那一列(分店的事實,不繼承)", async () => {
    renderLotterySettings({
      path: `/lottery-settings?org=${tenant.id}`,
      currentOrg: tenant,
    });
    await screen.findByText("盤點制度");
    expect(document.querySelector('[data-setting-key="opening"]')).toBeNull();
  });
});
