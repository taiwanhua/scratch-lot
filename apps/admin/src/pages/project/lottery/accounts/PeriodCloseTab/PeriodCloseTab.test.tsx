import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { ACCOUNTS_PERMISSIONS as P } from "@repo/domain/project/lottery-accounts";

import { blockedPeriodCheck } from "@/test/msw/project/lottery/period-close-fixtures";
import { restoreViewportAfterEach, setMobileViewport } from "@/test/viewport";

import { renderAccounts } from "../accounts-test-support";

const CLOSE_TAB = "/accounts?tab=close";

restoreViewportAfterEach();

/** 月份那一列(表格列)。 */
const rowOf = async (month: string) => {
  const cell = await screen.findByText(month);
  const row = cell.closest("tr");
  if (row === null) {
    throw new Error(`找不到 ${month} 那一列`);
  }
  return within(row);
};

/**
 * 關帳分頁(規格 10.4;Figma AC-06 93:1417、AC-07 93:1664):分頁與 [關帳] 看 `accounts.close-period`;
 * [關帳] 只在最早的未關帳月份;彈窗 = 檢查清單 + 快照預覽 + 輸入月份確認。
 */
describe("帳戶管理:關帳", () => {
  it("沒有 accounts.close-period → 看不到關帳分頁(也就沒有 [關帳])", async () => {
    renderAccounts({
      path: CLOSE_TAB,
      permissions: [P.viewBankAccounts, P.viewCash],
    });
    expect(
      await screen.findByRole("tab", { name: "銀行帳戶" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "關帳" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "關帳" }),
    ).not.toBeInTheDocument();
  });

  it("月份列表:進行中 / 未關帳 / 已關帳;[關帳] 只在最早的未關帳月份,已關帳的有 [快照]", async () => {
    renderAccounts({ path: CLOSE_TAB });
    const current = await rowOf("2026-10");
    expect(current.getByText("進行中")).toBeInTheDocument();
    expect(current.queryByRole("button")).not.toBeInTheDocument();
    const open = await rowOf("2026-09");
    expect(open.getByText("未關帳")).toBeInTheDocument();
    expect(open.getByRole("button", { name: "關帳" })).toBeInTheDocument();
    const closed = await rowOf("2026-08");
    expect(closed.getByText("已關帳")).toBeInTheDocument();
    expect(closed.getByText("王總")).toBeInTheDocument();
    expect(closed.getByRole("button", { name: "快照" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "關帳" })).toHaveLength(1);
  });

  it("[關帳] → 檢查清單 + 快照預覽;輸入月份相同才能按,送出後那個月變已關帳", async () => {
    const { user, fake } = renderAccounts({ path: CLOSE_TAB });
    const open = await rowOf("2026-09");
    await user.click(open.getByRole("button", { name: "關帳" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText("所有收銀班次都已結帳")).toBeInTheDocument();
    expect(
      dialog.getByText("沒有審核中且會記到 9 月的單據"),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(
        "每一班都被日結涵蓋計算:新竹店有 2 班沒有(只警告,記入快照)",
      ),
    ).toBeInTheDocument();
    expect(dialog.getByText("台灣銀行 末 34521 月底餘額")).toBeInTheDocument();
    expect(dialog.getByText("1,102,800")).toBeInTheDocument();
    expect(dialog.getByText("52,000 / 0")).toBeInTheDocument();
    expect(dialog.getByText("2 班")).toBeInTheDocument();

    const submit = dialog.getByRole("button", { name: "關帳" });
    expect(submit).toBeDisabled();
    const input = dialog.getByRole("textbox", { name: "輸入月份確認" });
    await user.type(input, "2026-08");
    expect(submit).toBeDisabled();
    await user.clear(input);
    await user.type(input, "2026-09");
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(fake.periods.inputs.close).toEqual([
      { month: "2026-09", confirmMonth: "2026-09", note: null },
    ]);
    const closed = await rowOf("2026-09");
    expect(await closed.findByText("已關帳")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "關帳" }),
    ).not.toBeInTheDocument();
  });

  it("有沒結帳的班、審核中的單據 → 清單列出,輸入月份也不能按 [關帳]", async () => {
    const { user } = renderAccounts({
      path: CLOSE_TAB,
      world: { periodClose: { check: blockedPeriodCheck } },
    });
    const open = await rowOf("2026-09");
    await user.click(open.getByRole("button", { name: "關帳" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(
      await dialog.findByText(
        "還有 1 個收銀班次沒結帳:中山店 店外攤位 · 王小明 09/30 21:00",
      ),
    ).toBeInTheDocument();
    expect(
      dialog.getByText("撤銷售出 #R-012(店內櫃台 · 王小明 09/30 17:00)審核中"),
    ).toBeInTheDocument();
    await user.type(
      dialog.getByRole("textbox", { name: "輸入月份確認" }),
      "2026-09",
    );
    expect(dialog.getByRole("button", { name: "關帳" })).toBeDisabled();
  });

  it("[快照]:關帳的人與時間、月底餘額、小金庫 / 抽屜", async () => {
    const { user } = renderAccounts({ path: CLOSE_TAB });
    const closed = await rowOf("2026-08");
    await user.click(closed.getByRole("button", { name: "快照" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(await dialog.findByText("快照 2026-08")).toBeInTheDocument();
    expect(dialog.getByText(/王總 於 .* 關帳/)).toBeInTheDocument();
    expect(dialog.getByText("86,400")).toBeInTheDocument();
    expect(dialog.getByText("31,500 / 2,000")).toBeInTheDocument();
  });

  it("手機:月份列表是卡片(月份、狀態、關帳時間、關帳人);[關帳] 只在最早的未關帳月份,已關帳的有 [快照]", async () => {
    setMobileViewport();
    renderAccounts({ path: CLOSE_TAB });
    expect(
      await screen.findByRole("list", { name: "關帳月份" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: "關帳月份" }),
    ).not.toBeInTheDocument();
    const cardOf = async (month: string) => {
      const text = await screen.findByText(month);
      const card = text.closest<HTMLElement>('[role="listitem"]');
      if (card === null) {
        throw new Error(`找不到 ${month} 那張卡片`);
      }
      return within(card);
    };
    const current = await cardOf("2026-10");
    expect(current.getByText("進行中")).toBeInTheDocument();
    expect(current.queryByRole("button")).not.toBeInTheDocument();
    const open = await cardOf("2026-09");
    expect(open.getByRole("button", { name: "關帳" })).toBeInTheDocument();
    const closed = await cardOf("2026-08");
    expect(closed.getByText("王總")).toBeInTheDocument();
    expect(closed.getByRole("button", { name: "快照" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "關帳" })).toHaveLength(1);
  });

  it("平板以上:月份列表照舊表格", async () => {
    renderAccounts({ path: CLOSE_TAB });
    expect(
      await screen.findByRole("table", { name: "關帳月份" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "關帳月份" }),
    ).not.toBeInTheDocument();
  });
});
