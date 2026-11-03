import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { LOTTERY_SETTINGS_PERMISSIONS as P } from "@repo/domain/project/lottery-settings";

import { lotterySettingsOrgs } from "@/test/msw/project/lottery/lottery-settings-fixtures";

import { renderLotterySettings } from "../lottery-settings-test-support";

const { tenant, zhongshan, minsheng } = lotterySettingsOrgs;

const rowOf = async (key: string): Promise<HTMLElement> => {
  await screen.findByText("盤點制度");
  const row = document.querySelector<HTMLElement>(
    `[data-setting-key="${CSS.escape(key)}"]`,
  );
  if (row === null) {
    throw new TypeError(`找不到設定列 ${key}`);
  }
  return row;
};

/**
 * 刮刮樂設定(Figma CS-50a～h;張數店規格第 4 節、9.1、9.2;驗收 16.2):
 * 走正式的頁面登記、路由與殼,只有 api 是假的。能不能改由 api 算好的 `canEdit` 決定,頁面只讀。
 */
describe("刮刮樂設定", () => {
  it("一條設定一列、依規格表順序:名稱 | 值 | 來源 | [自訂](SET1)", async () => {
    renderLotterySettings({
      world: { ownRows: { [tenant.id]: { renumber_required: "required" } } },
    });
    const rows = await Promise.all(
      [
        "count_mode",
        "renumber_required",
        "renumber_reminder",
        "transfer_grid_pick",
      ].map((key) => rowOf(key)),
    );
    expect(
      rows.map((row) => within(row).getAllByText(/./u)[0]?.textContent),
    ).toEqual([
      "盤點制度",
      "張數店補點編號",
      "補點編號提醒",
      "調貨單可點格子選張",
    ]);
    const [countMode, required] = rows;
    expect(within(countMode).getAllByText("編號盤點")).not.toHaveLength(0);
    expect(within(countMode).getByText("程式預設")).toBeInTheDocument();
    expect(within(required).getByText("沿用:好運彩券行")).toBeInTheDocument();
    expect(
      within(countMode).getByRole("button", { name: "自訂" }),
    ).toBeInTheDocument();
    // 分店的盤點制度才有 [變更紀錄]
    expect(
      within(countMode).getByRole("button", {
        name: "變更紀錄",
      }),
    ).toBeInTheDocument();
  });

  it("店長只有 view:看不到 [自訂] [還原];點開唯讀、只有 [關閉](SET1)", async () => {
    const { user } = renderLotterySettings({ permissions: [P.view] });
    const row = await rowOf("renumber_reminder");
    expect(
      within(row).queryByRole("button", { name: "自訂" }),
    ).not.toBeInTheDocument();
    await user.click(row);
    const dialog = await screen.findByRole("dialog", {
      name: "補點編號提醒 · 中山店",
    });
    expect(within(dialog).getByRole("radio", { name: "每週" })).toBeDisabled();
    expect(
      within(dialog).queryByRole("button", { name: "儲存" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "關閉" })).toBeEnabled();
  });

  it("[自訂] → 選值儲存:送出本層一列,列上變「本店自訂」並附上層值;[還原] 送出還原(SET1)", async () => {
    const { user, fake } = renderLotterySettings();
    const row = await rowOf("renumber_reminder");
    await user.click(within(row).getByRole("button", { name: "自訂" }));
    const dialog = await screen.findByRole("dialog", {
      name: "補點編號提醒 · 中山店",
    });
    await user.click(within(dialog).getByRole("radio", { name: "每週" }));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(fake.inputs.customize).toEqual([
        { orgId: zhongshan.id, key: "renumber_reminder", option: "weekly" },
      ]);
    });
    const updated = await rowOf("renumber_reminder");
    expect(await within(updated).findByText("本店自訂")).toBeInTheDocument();
    expect(within(updated).getByText("上層:每月")).toBeInTheDocument();

    await user.click(within(updated).getByRole("button", { name: "還原" }));
    await waitFor(() => {
      expect(fake.inputs.restore).toEqual([
        { orgId: zhongshan.id, key: "renumber_reminder" },
      ]);
    });
  });

  it("在最上層組織改盤點制度預設:列出會跟著改成張數的分店(自訂了的不列),確認後才存(SET2)", async () => {
    const { user, fake } = renderLotterySettings({
      path: `/lottery-settings?org=${tenant.id}`,
      currentOrg: tenant,
      world: { ownRows: { "org-ls-hsinchu": { count_mode: "numbered" } } },
    });
    await user.click(await rowOf("count_mode"));
    const dialog = await screen.findByRole("dialog", {
      name: "盤點制度預設 · 好運彩券行",
    });
    expect(
      within(dialog).getByText("沿用預設的分店會跟著改成張數。"),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: "張數盤點" }));
    expect(
      await within(dialog).findByText("會跟著改成張數的分店"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("中山店、民生店")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(fake.inputs.customize).toEqual([
        { orgId: tenant.id, key: "count_mode", option: "count" },
      ]);
    });
    expect(fake.storeModes[zhongshan.id]).toBe("count");
    expect(fake.storeModes[minsheng.id]).toBe("count");
  });

  it("上層改預設時,會跟著改成張數的分店有待標註、或有進行中的盤點:列出原因、不能存(9.1)", async () => {
    const { user } = renderLotterySettings({
      path: `/lottery-settings?org=${tenant.id}`,
      currentOrg: tenant,
      world: {
        pendingSkipBooks: {
          [minsheng.id]: [
            {
              __typename: "LotteryCountModePendingSkipBook",
              orgId: minsheng.id,
              orgName: "民生店",
              cashPointName: "店內櫃台",
              gameCode: "5201",
              gameName: "金好運",
              bookNo: "060116",
              pendingCount: 2,
            },
          ],
        },
        busyStores: ["org-ls-hsinchu"],
      },
    });
    await user.click(await rowOf("count_mode"));
    const dialog = await screen.findByRole("dialog", {
      name: "盤點制度預設 · 好運彩券行",
    });
    await user.click(within(dialog).getByRole("radio", { name: "張數盤點" }));
    expect(
      await within(dialog).findByText(
        /這次不能存:民生店 店內櫃台 5201 · 060116 待標註 2 張.*新竹店有進行中的盤點/u,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "儲存" })).toBeDisabled();
  });

  it("分店改張數:檯面上還有待標註的本 → 列出本、寫「請先到看板標完跳號再改」、不能存(CS-50c)", async () => {
    const { user } = renderLotterySettings({
      path: `/lottery-settings?org=${minsheng.id}`,
      currentOrg: minsheng,
      world: {
        pendingSkipBooks: {
          [minsheng.id]: [
            {
              __typename: "LotteryCountModePendingSkipBook",
              orgId: minsheng.id,
              orgName: "民生店",
              cashPointName: "店內櫃台",
              gameCode: "5201",
              gameName: "金好運",
              bookNo: "060116",
              pendingCount: 2,
            },
          ],
        },
      },
    });
    await user.click(await rowOf("count_mode"));
    const dialog = await screen.findByRole("dialog", {
      name: "盤點制度 · 民生店",
    });
    await user.click(within(dialog).getByRole("radio", { name: "張數盤點" }));
    expect(
      await within(dialog).findByText(
        "檯面上還有待標註的本,請先到看板標完跳號再改。",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("店內櫃台 · 5201 金好運 · 本號 060116"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("待標註 2 張")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "儲存" })).toBeDisabled();
  });

  it("張數店改編號、還有未對號:寫出會進入轉換中(SW1、CS-50b)", async () => {
    const { user, fake } = renderLotterySettings({
      world: {
        ownRows: { [zhongshan.id]: { count_mode: "count" } },
        storeModes: { [zhongshan.id]: "count" },
        unmatchedStores: [zhongshan.id],
      },
    });
    await user.click(await rowOf("count_mode"));
    const dialog = await screen.findByRole("dialog", {
      name: "盤點制度 · 中山店",
    });
    await user.click(within(dialog).getByRole("radio", { name: "編號盤點" }));
    expect(
      await within(dialog).findByText(
        "中山店會進入轉換中,直到補點編號核准;轉換中不能依張數標記售出、依張數移櫃。",
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(fake.storeModes[zhongshan.id]).toBe("converting");
    });
    const row = await rowOf("count_mode");
    expect(
      await within(row).findAllByText("張數盤點 → 編號盤點(轉換中,等補點編號)"),
    ).not.toHaveLength(0);
  });

  it("轉換中:[取消轉換] → 確認視窗寫出後果 → 回到張數盤點(SW3、CS-50e、CS-50g)", async () => {
    const { user, fake } = renderLotterySettings({
      world: {
        ownRows: { [zhongshan.id]: { count_mode: "numbered" } },
        storeModes: { [zhongshan.id]: "converting" },
      },
    });
    const row = await rowOf("count_mode");
    expect(
      within(row).getAllByText("張數盤點 → 編號盤點(轉換中,等補點編號)"),
    ).not.toHaveLength(0);
    await user.click(within(row).getByRole("button", { name: "取消轉換" }));
    const dialog = await screen.findByRole("dialog", {
      name: "取消中山店的轉換?",
    });
    expect(
      within(dialog).getByText(/要按 \[還原\] 才恢復沿用/u),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "取消轉換" }));
    await waitFor(() => {
      expect(fake.inputs.cancel).toEqual([{ orgId: zhongshan.id }]);
    });
    const updated = await rowOf("count_mode");
    expect(await within(updated).findAllByText("張數盤點")).not.toHaveLength(0);
    expect(within(updated).getByText("本店自訂")).toBeInTheDocument();
  });

  it("店長看得到轉換中,但沒有 [取消轉換](SW3)", async () => {
    renderLotterySettings({
      permissions: [P.view],
      world: { storeModes: { [zhongshan.id]: "converting" } },
    });
    const row = await rowOf("count_mode");
    expect(
      within(row).getAllByText("張數盤點 → 編號盤點(轉換中,等補點編號)"),
    ).not.toHaveLength(0);
    expect(
      within(row).queryByRole("button", { name: "取消轉換" }),
    ).not.toBeInTheDocument();
  });

  it("[變更紀錄]:新到舊,時間 · 誰、從哪種到哪種(CS-50h)", async () => {
    const { user } = renderLotterySettings({
      world: {
        history: {
          [zhongshan.id]: [
            {
              __typename: "LotteryStoreCountModeHistoryEntry",
              from: "converting",
              to: "count",
              at: "2026-10-20T07:30:00.000Z",
              byName: "王小明",
              cause: "convert_cancelled",
              stocktakeId: null,
            },
            {
              __typename: "LotteryStoreCountModeHistoryEntry",
              from: "numbered",
              to: "count",
              at: "2026-10-01T01:00:00.000Z",
              byName: "何家華",
              cause: "setting",
              stocktakeId: null,
            },
          ],
        },
      },
    });
    const row = await rowOf("count_mode");
    await user.click(within(row).getByRole("button", { name: "變更紀錄" }));
    const dialog = await screen.findByRole("dialog", {
      name: "盤點制度變更紀錄 · 中山店",
    });
    expect(
      await within(dialog).findByText("轉換中 → 張數(取消轉換)"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("編號 → 張數(設定)")).toBeInTheDocument();
    expect(
      within(dialog).getByText("10/20 15:30 · 王小明"),
    ).toBeInTheDocument();
  });

  it("張數店補點編號從必須改成只提醒:寫出這個月關帳改成只警告(CS-50f)", async () => {
    const { user } = renderLotterySettings({
      world: { ownRows: { [tenant.id]: { renumber_required: "required" } } },
    });
    await user.click(await rowOf("renumber_required"));
    const dialog = await screen.findByRole("dialog", {
      name: "張數店補點編號 · 中山店",
    });
    expect(
      within(dialog).queryByText(/這個月關帳時改成只警告/u),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: "只提醒" }));
    expect(
      within(dialog).getByText(/這個月關帳時改成只警告/u),
    ).toBeInTheDocument();
  });

  it("最上層組織沒有 edit-default:canEdit = false,看不到 [自訂](權限分法同排班規則)", async () => {
    renderLotterySettings({
      path: `/lottery-settings?org=${tenant.id}`,
      currentOrg: tenant,
      permissions: [P.view, P.editOrg],
    });
    const row = await rowOf("count_mode");
    expect(
      within(row).queryByRole("button", { name: "自訂" }),
    ).not.toBeInTheDocument();
    // 最上層組織不是分店:沒有 [變更紀錄]
    expect(
      within(row).queryByRole("button", { name: "變更紀錄" }),
    ).not.toBeInTheDocument();
  });
});
