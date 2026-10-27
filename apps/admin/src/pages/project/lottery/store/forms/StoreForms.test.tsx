import { beforeEach, describe, expect, it } from "@jest/globals";
import { act, screen, waitFor, within } from "@testing-library/react";

import { injectScan } from "@/hooks/project/useScanner/scanner-registry";
import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";

import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";

/**
 * 店面管理 → 撤銷售出申請、現金更正單(規格 8.5、8.8、6.1;Figma ST-31a / 31b / 32a / 32b、ST-08b):
 * 兩個分頁的列表、[+ 新增](B9b)、沒有 [存草稿]、撤銷售出申請的替換新增頁(刷條碼、依本分組的格子、
 * 原因帶入退款、退款班次預設目前的班)、看板 [送撤銷售出申請] 帶入那一張。
 */
describe("店面管理:撤銷售出申請、現金更正單", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("撤銷售出分頁:Figma ST-31a 的列(張數、原因、退款、退款班次、狀態),[+ 新增] 開替換新增頁、沒有 [存草稿]", async () => {
    const { user } = renderStore({ path: "/store?tab=sale-reversals" });
    const table = await screen.findByRole("table", {
      name: "撤銷售出申請列表",
    });
    expect(
      await within(table).findByText("5164 #031–032(2 張)"),
    ).toBeInTheDocument();
    expect(within(table).getByText("客人退貨")).toBeInTheDocument();
    expect(within(table).getByText("400")).toBeInTheDocument();
    expect(
      within(table).getByText("店內櫃台 · 李小華 10/16 13:00"),
    ).toBeInTheDocument();
    expect(within(table).getByText("審核中")).toBeInTheDocument();
    expect(within(table).getByText("已完成")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "+ 新增撤銷售出申請" }),
    );
    expect(
      await screen.findByRole("heading", { name: "撤銷售出申請" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送出" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "存草稿" })).toBeNull();
  });

  it("B9b:沒有撤銷售出申請的新增權限 → 撤銷售出分頁沒有 [+ 新增];現金更正照常", async () => {
    const { user } = renderStore({
      path: "/store?tab=sale-reversals",
      forms: { canCreateSaleReversal: false },
    });
    await screen.findByRole("table", { name: "撤銷售出申請列表" });
    expect(
      screen.queryByRole("button", { name: "+ 新增撤銷售出申請" }),
    ).toBeNull();
    await user.click(screen.getByRole("tab", { name: "現金更正" }));
    await screen.findByRole("table", { name: "現金更正單列表" });
    expect(
      screen.getByRole("button", { name: "+ 新增現金更正單" }),
    ).toBeInTheDocument();
  });

  it("現金更正分頁:Figma ST-32a 的列;[+ 新增] 開表單引擎的新增頁(不替換頁面)、沒有 [存草稿]", async () => {
    const { user } = renderStore({ path: "/store?tab=cash-corrections" });
    const table = await screen.findByRole("table", {
      name: "現金更正單列表",
    });
    expect(await within(table).findByText("X-0012")).toBeInTheDocument();
    expect(within(table).getByText("現金增加")).toBeInTheDocument();
    expect(within(table).getByText("小金庫")).toBeInTheDocument();
    expect(
      within(table).getByText("店外攤位 · 陳美玲 10/12 14:00"),
    ).toBeInTheDocument();
    expect(within(table).getByText("假鈔")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ 新增現金更正單" }));
    expect(await screen.findByText("位置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送出" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "存草稿" })).toBeNull();
  });

  it("新增頁:刷條碼加入那一本的格子;原因「客人退貨」帶入退款 = 是、退款班次預設目前的班;送出的值依本分組", async () => {
    const { user, runtime } = renderStore({
      path: `/store/create-page/sale_reversal?org=${STORE_A}`,
    });
    const scan = await screen.findByRole("textbox", {
      name: "刷條碼加入張數",
    });
    await user.type(scan, "056527-012{Enter}");
    expect(
      await screen.findByRole("heading", {
        name: "5164 發大財 · 本號 056527",
      }),
    ).toBeInTheDocument();
    // 未售的張(#066 之後)不能選
    expect(
      await screen.findByRole("button", { name: /^#012/u }),
    ).toHaveAttribute("aria-pressed", "true");

    // 還沒選原因 → 送不出去
    await user.click(screen.getByRole("button", { name: "送出" }));
    expect(runtime.inputs.createAndSubmitFormSubmission).toHaveLength(0);

    await user.click(screen.getByRole("combobox", { name: "原因" }));
    await user.click(await screen.findByRole("option", { name: "客人退貨" }));
    expect(screen.getByRole("radio", { name: "是" })).toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "退款班次" }),
    ).toHaveTextContent("店內櫃台 · 王小明 10/16 08:02(目前的班)");
    expect(screen.getByText("200")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(runtime.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    const [sent] = runtime.inputs.createAndSubmitFormSubmission;
    expect(sent).toMatchObject({
      formKey: "sale_reversal",
      values: {
        branch: STORE_A,
        reason: "customer-return",
        refund: "yes",
        refund_shift: "shift-counter",
        refund_amount: 200,
        lines: [{ book: "b-1", ticket_nos: "012", tickets: 1, amount: 200 }],
      },
    });
  });

  it("看板撤銷確認視窗不符合當下撤銷 → [送撤銷售出申請] 開新增頁並帶入那一張", async () => {
    const { user } = renderStore({
      path: `/store/create-page/sale_reversal?org=${STORE_A}&ticket=b-1-t20`,
    });
    expect(
      await screen.findByRole("heading", {
        name: "5164 發大財 · 本號 056527",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /^#020/u }),
    ).toHaveAttribute("aria-pressed", "true");
    // 原因選「刷錯刮刮樂」→ 退款 = 否(之後可改)
    await user.click(screen.getByRole("combobox", { name: "原因" }));
    await user.click(await screen.findByRole("option", { name: "刷錯刮刮樂" }));
    expect(screen.getByRole("radio", { name: "否" })).toBeChecked();
    expect(screen.queryByRole("combobox", { name: "退款班次" })).toBeNull();
  });

  it("看板展開卡片 [撤銷售出] 不符合當下撤銷 → [送撤銷售出申請] 開新增頁並帶入那一張", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    const { user } = renderStore();
    const heading = await screen.findByRole("heading", { name: "店內櫃台" });
    const section =
      heading.closest<HTMLElement>(".MuiCard-root")?.parentElement;
    if (section == null) {
      throw new Error("找不到店內櫃台");
    }
    const card = within(section)
      .getByText("5164 發大財")
      .closest<HTMLElement>("button");
    if (card === null) {
      throw new Error("找不到卡片");
    }
    await user.click(card);
    const panel = await within(section).findByLabelText(
      "5164 發大財 · 本號 056527",
    );
    await user.click(
      await within(panel).findByRole("button", { name: "#060 本班售出" }),
    );
    await user.click(within(panel).getByRole("button", { name: "撤銷售出" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      await within(dialog).findByRole("button", { name: "送撤銷售出申請" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "5164 發大財 · 本號 056527",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /^#060/u }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("新增頁宣告自己的掃描用途:條碼槍刷到的張加進格子,不會跳快速銷售", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    const { salesFake } = renderStore({
      path: `/store/create-page/sale_reversal?org=${STORE_A}`,
    });
    await screen.findByRole("textbox", { name: "刷條碼加入張數" });
    act(() => {
      injectScan("0056527015");
    });
    expect(
      await screen.findByRole("heading", {
        name: "5164 發大財 · 本號 056527",
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /^#015/u }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(salesFake.inputs.sell).toHaveLength(0);
  });
});
