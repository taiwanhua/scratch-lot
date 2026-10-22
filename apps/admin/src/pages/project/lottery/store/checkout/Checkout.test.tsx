import { beforeEach, describe, expect, it } from "@jest/globals";
import { act, screen, waitFor, within } from "@testing-library/react";

import {
  STORE_PERMISSIONS,
  parseCheckoutDraft,
} from "@repo/domain/project/lottery";

import { injectScan } from "@/hooks/project/useScanner/scanner-registry";
import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";
import { STORE_ALL_PERMISSIONS } from "@/test/msw/project/lottery/store-fixtures";

import { fastUser } from "../../../schedule/manage/roster/roster-test-queries";
import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";
/** 店內櫃台(王小明 08:02 開班)的交班精靈。 */
const WIZARD_PATH = `/store/create-page/checkout_confirm?org=${STORE_A}&shift=shift-counter`;

const countInput = (value: number) =>
  screen.getByRole("spinbutton", {
    name: `張 / 枚 ${value.toLocaleString("en-US")}`,
  });

/** 第 ① 步沿用盤點 → 第 ② 步 → 第 ③ 步。 */
const toDrawerStep = async (user: ReturnType<typeof fastUser>) => {
  await screen.findByRole("heading", { name: "交班結帳 · 店內櫃台" });
  await user.click(screen.getByRole("button", { name: "下一步" }));
  await screen.findByText("② 兌獎(本班 3 筆)");
  await user.click(screen.getByRole("button", { name: "下一步" }));
  await screen.findByText("實點(依面額清點)");
};

/**
 * 交班結帳(規格 6.0、6.9、8.7;Figma ST-17a / 17b / 18 / 19a / 19b / 27 / 28a):看板的 [交班結帳] 與權限、
 * 四步精靈(沿用盤點、兌獎與補登、依面額清點與差額原因、交接)、送出的結帳內容、取消不留資料、
 * 刷條碼不會被當成售出、班次結帳歷史紀錄、檢視頁。
 */
describe("店面管理:交班結帳", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("看板:本機收銀點自己的班有 [交班結帳];沒有 store.checkout 看不到;按下 → 交班精靈", async () => {
    const user = fastUser();
    writeLocalCashPoint(STORE_A, "cp-counter");
    renderStore();
    const heading = await screen.findByRole("heading", { name: "店內櫃台" });
    const header = heading.closest("[class*='MuiCard']");
    if (header === null) {
      throw new Error("沒有店內櫃台的標題列");
    }
    await user.click(
      within(header as HTMLElement).getByRole("button", { name: "交班結帳" }),
    );
    expect(
      await screen.findByRole("heading", { name: "交班結帳 · 店內櫃台" }),
    ).toBeInTheDocument();
    expect(screen.getByText("王小明 · 08:02 開班")).toBeInTheDocument();
    // 第 ① 步:有 30 分鐘內的盤點可以沿用(預設選它)
    expect(
      screen.getByRole("radio", { name: "沿用 30 分鐘內的盤點" }),
    ).toBeChecked();
    expect(screen.getByText("10:32 · 店內櫃台 · 差異 0")).toBeInTheDocument();
  });

  it("沒有 store.checkout → 看板沒有 [交班結帳]", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    renderStore({
      permissions: STORE_ALL_PERMISSIONS.filter(
        (key) => key !== STORE_PERMISSIONS.checkout,
      ),
    });
    await screen.findByRole("heading", { name: "店內櫃台" });
    expect(screen.queryByRole("button", { name: "交班結帳" })).toBeNull();
  });

  it("精靈:② 兌獎逐筆與合計、[補登兌獎] 開兌獎視窗(立即生效);③ 依面額清點、差額與原因、審核中的單據自動帶入;④ 交接 → 送出結帳內容", async () => {
    const user = fastUser();
    const { runtime, redemptions } = renderStore({ path: WIZARD_PATH });
    await screen.findByRole("heading", { name: "交班結帳 · 店內櫃台" });
    await user.click(screen.getByRole("button", { name: "下一步" }));

    // ② 兌獎
    await screen.findByText("② 兌獎(本班 3 筆)");
    expect(screen.getByText("5164-056527-031")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("立即生效")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "補登兌獎" }));
    const code = await screen.findByRole("textbox", { name: "刷背面編號" });
    await user.type(code, "5164-1-056527-040-0-6{Enter}");
    await user.click(await screen.findByRole("button", { name: "500" }));
    await user.click(screen.getByRole("button", { name: "確認兌獎" }));
    await waitFor(() => {
      expect(redemptions.inputs.redeem).toHaveLength(1);
    });
    expect(redemptions.inputs.redeem[0]).toMatchObject({
      shiftId: "shift-counter",
      prizeAmount: 500,
    });
    await user.click(screen.getByRole("button", { name: "下一步" }));

    // ③ 抽屜:應有逐項、面額清點、差額、原因自動帶入「審核中的單據」
    await screen.findByText("實點(依面額清點)");
    expect(screen.getByText("銷售(142 張)")).toBeInTheDocument();
    expect(screen.getByText("+ 14,550")).toBeInTheDocument();
    expect(screen.getByText("12,350")).toBeInTheDocument();
    expect(
      screen.getByText(
        "審核中:現金更正 #X-012 + 500、撤銷售出 #SR-008 − 500 → 已自動帶入差額原因說明。",
      ),
    ).toBeInTheDocument();
    await user.type(countInput(1000), "12");
    await user.type(countInput(100), "3");
    expect(screen.getByText("12,300")).toBeInTheDocument();
    expect(screen.getByText("− 50")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /差額原因/u }),
    ).toHaveTextContent("審核中的單據");
    // 點開兌獎那一項的明細
    await user.click(screen.getByRole("button", { name: "展開 兌獎 的明細" }));
    expect(await screen.findByText("5201-001233-077")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一步" }));

    // ④ 確認:沒有接班人 → 留給下一班必須是 0;選接班人後送出
    await screen.findByText("交接");
    expect(
      screen.getByText("沒有接班人:這張結帳確認申請改由店長審核。"),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "留給下一班" }),
      "3000",
    );
    expect(
      screen.getByText("沒有接班人時必須是 0:請先把錢投庫"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送出" })).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: /接班人/u }));
    await user.click(await screen.findByRole("option", { name: "李小華" }));
    expect(screen.queryByText("沒有接班人時必須是 0:請先把錢投庫")).toBeNull();
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(runtime.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    const sent = runtime.inputs.createAndSubmitFormSubmission.at(0);
    expect(sent).toMatchObject({
      formKey: "checkout_confirm",
      values: {
        branch: STORE_A,
        type: "shift",
        cash_point: "店內櫃台",
        successor: { id: "user-li", label: "李小華" },
        expected: 12_350,
        counted: 12_300,
        difference: -50,
        left_for_next: 3000,
      },
    });
    const parsed = parseCheckoutDraft(sent?.values?.draft);
    expect(parsed.ok && parsed.draft).toMatchObject({
      shiftId: "shift-counter",
      cashPointId: "cp-counter",
      stocktake: { mode: "reuse", submissionId: "sub-stocktake-32" },
      denominations: [
        { value: 1000, count: 12 },
        { value: 100, count: 3 },
      ],
      diffReasonKey: "pending-documents",
      diffReasonNote: "審核中:現金更正 #X-012 + 500、撤銷售出 #SR-008 − 500",
      leftForNext: 3000,
      successorId: "user-li",
    });
  });

  it("精靈 [取消] 不留任何資料;① 現在盤點時刷條碼記為「在」,不會被當成售出", async () => {
    const user = fastUser();
    const { runtime, salesFake } = renderStore({ path: WIZARD_PATH });
    await screen.findByRole("heading", { name: "交班結帳 · 店內櫃台" });
    await user.click(screen.getByRole("radio", { name: "現在盤點" }));
    await screen.findByText("5164 發大財", { selector: "p" });
    act(() => {
      injectScan("0056527040");
    });
    await waitFor(() => {
      expect(
        document.querySelector('[aria-label="#040 在(已點)"]'),
      ).toHaveAttribute("aria-pressed", "true");
    });
    expect(salesFake.inputs.sell).toHaveLength(0);
    // 還沒差異核對 → 不能到下一步
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(
      await screen.findByRole("tab", { name: "看板" }),
    ).toBeInTheDocument();
    expect(runtime.inputs.createAndSubmitFormSubmission).toHaveLength(0);
    expect(runtime.inputs.createFormDraft).toHaveLength(0);
  });

  it("沒有接班人、留給下一班 0 → 可以送出(改由店長審核)", async () => {
    const user = fastUser();
    const { runtime } = renderStore({ path: WIZARD_PATH });
    await toDrawerStep(user);
    await user.type(countInput(1000), "12");
    await user.type(countInput(100), "3");
    await user.type(countInput(50), "1");
    // 應有與實點合計都是 12,350
    expect(screen.getAllByText("12,350")).toHaveLength(2);
    expect(screen.queryByRole("combobox", { name: /差額原因/u })).toBeNull();
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await screen.findByText("交接");
    // 留給下一班不能超過實點
    const left = screen.getByRole("textbox", { name: "留給下一班" });
    await user.type(left, "12351");
    expect(
      screen.getByText("留給下一班不能超過實點 12,350"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送出" })).toBeDisabled();
    await user.clear(left);
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(runtime.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    expect(runtime.inputs.createAndSubmitFormSubmission[0]).toMatchObject({
      values: { successor: null, left_for_next: 0, difference: 0 },
    });
  });

  it("班次結帳歷史紀錄分頁(ST-27):「待審核」篩選;點一列 → 結帳確認申請檢視頁(ST-28a)", async () => {
    const user = fastUser();
    renderStore({ path: "/store?tab=checkouts" });
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("C-0042")).toBeInTheDocument();
    expect(within(table).getByText("C-0040")).toBeInTheDocument();
    expect(within(table).getByText("日結")).toBeInTheDocument();
    expect(within(table).getByText("− 100")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "狀態" }));
    await user.click(await screen.findByRole("option", { name: "待審核" }));
    await waitFor(() => {
      expect(within(table).queryByText("C-0040")).toBeNull();
    });
    await user.click(within(table).getByText("C-0042"));
    expect(
      await screen.findByRole("heading", {
        name: "結帳確認申請 · 交班 C-0042",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("申請人 李小華 · 送出 10/16 22:10"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("沿用 10/16 21:40 全店盤點 ST-0032"),
    ).toBeInTheDocument();
    expect(screen.getByText("− 100 · 找錯錢")).toBeInTheDocument();
    expect(screen.getByText("0 / (沒有接班人)")).toBeInTheDocument();
    expect(screen.getAllByText("6,400").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "核准" })).toBeInTheDocument();
  });
});
