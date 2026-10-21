import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  STORE_PERMISSIONS,
  parseDailyCloseDraft,
} from "@repo/domain/project/lottery";

import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";
import {
  STORE_ALL_PERMISSIONS,
  sampleStoreBoard,
} from "@/test/msw/project/lottery/store-fixtures";

import { fastUser } from "../../../schedule/manage/roster/roster-test-queries";
import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";
const WIZARD_PATH = `/store/create-page/checkout_confirm?org=${STORE_A}&type=daily`;

/** 看板:所有收銀點都沒有開著的班(都已送出交班)。 */
const closedBoard = () => {
  const board = sampleStoreBoard();
  return {
    ...board,
    cashPoints: board.cashPoints.map((point) => ({ ...point, shift: null })),
    myOpenShifts: [],
  };
};

const countInput = (value: number) =>
  screen.getByRole("spinbutton", {
    name: `張 / 枚 ${value.toLocaleString("en-US")}`,
  });

/**
 * 日結與存銀行(規格 6.1、6.10、6.11、8.7;Figma ST-20–26b、ST-28b):看板頂部的上次日結、[存銀行] [日結] 與權限、
 * [日結] 停用時的提示、存銀行視窗(自動帶入帳戶、超過小金庫應有、沒有帳戶)、五步精靈(各班結帳與側邊審核、全店盤點、
 * 小金庫、存入銀行、確認 → 送出的結帳內容)、日結的檢視頁。
 */
describe("店面管理:日結與存銀行", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("看板頂部:上次日結、[存銀行] [日結];還有班沒交班 → [日結] 停用,滑過列出還沒交班的收銀點", async () => {
    const user = fastUser();
    writeLocalCashPoint(STORE_A, "cp-counter");
    renderStore();
    expect(
      await screen.findByText("上次日結:10/13(已 3 天)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "存銀行" })).toBeEnabled();
    const daily = screen.getByRole("button", { name: "日結" });
    expect(daily).toBeDisabled();
    await user.hover(daily.parentElement ?? daily);
    expect(await screen.findByText(/店內櫃台還沒交班/u)).toBeInTheDocument();
    expect(screen.getByText(/店外攤位還沒交班/u)).toBeInTheDocument();
  });

  it("沒有 store.checkout / store.bank-deposit → 看不到 [日結] / [存銀行]", async () => {
    renderStore({
      permissions: STORE_ALL_PERMISSIONS.filter(
        (key) =>
          key !== STORE_PERMISSIONS.checkout &&
          key !== STORE_PERMISSIONS.bankDeposit,
      ),
    });
    await screen.findByText("上次日結:10/13(已 3 天)");
    expect(screen.queryByRole("button", { name: "日結" })).toBeNull();
    expect(screen.queryByRole("button", { name: "存銀行" })).toBeNull();
  });

  it("所有班都已交班 → [日結] 打開日結精靈", async () => {
    const user = fastUser();
    renderStore({ world: { board: closedBoard() } });
    await user.click(await screen.findByRole("button", { name: "日結" }));
    expect(
      await screen.findByRole("heading", { name: "日結 · 中山店" }),
    ).toBeInTheDocument();
  });

  it("存銀行:只有一個帳戶自動帶入;超過小金庫應有 → 提示並不能送;金額內 → 存入", async () => {
    const user = fastUser();
    const { dailyClose } = renderStore();
    await user.click(await screen.findByRole("button", { name: "存銀行" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("中山店 · 小金庫目前應有 24,000"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("台灣銀行 中山分行 ****12345"),
    ).toBeInTheDocument();
    const amount = within(dialog).getByRole("textbox", { name: /金額/u });
    await user.type(amount, "30000");
    expect(
      within(dialog).getByText(/超過小金庫目前應有金額 24,000/u),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "確認存入" }),
    ).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, "20000");
    await user.click(within(dialog).getByRole("button", { name: "確認存入" }));
    await waitFor(() => {
      expect(dailyClose.inputs.deposits).toHaveLength(1);
    });
    expect(dailyClose.inputs.deposits[0]).toMatchObject({
      orgId: STORE_A,
      amount: 20_000,
      accountId: "acc-1",
    });
  });

  it("存銀行:本店沒有可用的銀行帳戶 → ST-26b 錯誤、不能存", async () => {
    const user = fastUser();
    renderStore({ dailyCloseOptions: { bankForm: { accounts: [] } } });
    await user.click(await screen.findByRole("button", { name: "存銀行" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(/本店沒有可用的銀行帳戶/u),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "確認存入" }),
    ).toBeDisabled();
  });

  it("精靈 ①:涵蓋計算期間、各班狀態(你 / 等某某 / 待某某更正)、[審核] 側邊打開結帳單;沒全部核准不能下一步", async () => {
    const user = fastUser();
    renderStore({ path: WIZARD_PATH });
    await screen.findByRole("heading", { name: "日結 · 中山店" });
    expect(
      screen.getByText(
        "涵蓋計算期間 10/14 09:02 ~ 現在(10/14、10/15 沒有日結)。不能補日結,這一次會一起涵蓋計算。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("等王小明核准")).toBeInTheDocument();
    expect(screen.getByText("待陳美玲更正")).toBeInTheDocument();
    expect(
      screen.getByText(
        "還有 3 班沒核准,全部核准後才能下一步。狀態會即時更新。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "審核" }));
    expect(
      await screen.findByText("結帳單 C-0042 · 店內櫃台 · 李小華"),
    ).toBeInTheDocument();
  });

  it("精靈 ②–⑤:沿用全店盤點 → 小金庫依面額清點 → 存入銀行(帳戶自動帶入)→ 確認 → 送出的結帳內容(類型 = 日結)", async () => {
    const user = fastUser();
    const { runtime } = renderStore({
      path: WIZARD_PATH,
      dailyCloseOptions: { allApproved: true },
    });
    await screen.findByRole("heading", { name: "日結 · 中山店" });
    expect(
      screen.getByText("各班結帳都已核准,可以到下一步。"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByText("② 全店盤點")).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "沿用 30 分鐘內的盤點" }),
    ).toBeChecked();
    await user.click(screen.getByRole("button", { name: "下一步" }));

    // ③ 小金庫:期初(10/13 日結清點)20,000 … 應有 24,000
    expect(await screen.findByText("期初(10/13 日結清點)")).toBeInTheDocument();
    expect(screen.getByText("存銀行(1 筆)")).toBeInTheDocument();
    await user.type(countInput(1000), "24");
    // 差額 0 → 不用原因、可以下一步
    expect(screen.queryByText("差額原因(必填)")).toBeNull();
    expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "下一步" }));

    // ④ 存入銀行
    expect(await screen.findByText("④ 存入銀行")).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "存入金額(0 = 不存)" }),
      "20000",
    );
    expect(screen.getByText("4,000")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一步" }));

    // ⑤ 確認
    expect(await screen.findByText("⑤ 確認")).toBeInTheDocument();
    expect(screen.getByText("10/14 09:02 ~ 現在")).toBeInTheDocument();
    expect(
      screen.getByText("20,000 → 台灣銀行 中山分行 ****12345"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "送出結帳確認申請" }));
    await waitFor(() => {
      expect(runtime.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    const sent = runtime.inputs.createAndSubmitFormSubmission.at(0);
    expect(sent?.values).toMatchObject({ type: "daily", branch: STORE_A });
    const parsed = parseDailyCloseDraft(sent?.values?.draft);
    expect(parsed.ok && parsed.draft).toMatchObject({
      type: "daily",
      orgId: STORE_A,
      stocktake: { mode: "reuse" },
      denominations: [{ value: 1000, count: 24 }],
      diffReasonKey: null,
      bankDeposit: { amount: 20_000, accountId: "acc-1" },
    });
  });

  it("檢視頁(日結):涵蓋計算期間、涵蓋計算的班、小金庫、存入銀行", async () => {
    renderStore({ path: "/store/view-page/sub-checkout-43" });
    expect(
      await screen.findByRole("heading", {
        name: "結帳確認申請 · 日結 C-0043",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("3 班(C-0040、C-0041、C-0042)"),
    ).toBeInTheDocument();
    expect(screen.getByText("10/16 09:02 ~ 10/16 22:30")).toBeInTheDocument();
    expect(screen.getByText("20,000 → 台銀 ·····12345")).toBeInTheDocument();
    expect(screen.getByText("小金庫期初")).toBeInTheDocument();
  });
});
