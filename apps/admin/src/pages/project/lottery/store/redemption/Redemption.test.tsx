import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, screen, waitFor, within } from "@testing-library/react";

import { STORE_PERMISSIONS as P } from "@repo/domain/project/lottery";

import { injectScan } from "@/hooks/project/useScanner/scanner-registry";
import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";
import { graphqlError } from "@/test/msw/auth-handlers";
import {
  type RedemptionFixture,
  redemptionRow,
  sampleRedemptions,
} from "@/test/msw/project/lottery/redemption-fixtures";
import { api, server } from "@/test/msw/server";

import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";

const headerOf = async (name: string): Promise<HTMLElement> => {
  const heading = await screen.findByRole("heading", { name });
  const card = heading.closest<HTMLElement>(".MuiCard-root");
  if (card === null) {
    throw new Error(`找不到收銀點標題列:${name}`);
  }
  return card;
};

/** [最近兌獎] 抽屜(以標題找到抽屜本體)。 */
const recentDrawer = async (): Promise<HTMLElement> => {
  const title = await screen.findByText("最近兌獎 · 店內櫃台");
  const paper = title.closest<HTMLElement>(".MuiDrawer-paper");
  if (paper === null) {
    throw new Error("找不到 [最近兌獎] 抽屜");
  }
  return paper;
};

/**
 * 兌獎(規格 6.5;Figma ST-11a/b、ST-38a/b、ST-39a/b/c、ST-40、ST-41):看板的 [兌獎] [最近兌獎]、
 * 兌獎提示的 [撤銷]、撤銷兩層、兌獎紀錄分頁與詳情;沒有權限看不到按鈕。
 */
describe("店面管理:兌獎", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    writeLocalCashPoint(STORE_A, "cp-counter");
  });

  it("本機收銀點開班中:[兌獎] 在按鈕列最前面、自己的班有 [最近兌獎];沒有 store.redeem 看不到 [兌獎]", async () => {
    const { unmount } = renderStore();
    const counter = await headerOf("店內櫃台");
    const names = within(counter)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names.indexOf("兌獎")).toBeLessThan(names.indexOf("投庫"));
    expect(names).toContain("最近兌獎");
    unmount();

    renderStore({ permissions: [P.view] });
    const other = await headerOf("店內櫃台");
    expect(within(other).queryByRole("button", { name: "兌獎" })).toBeNull();
  });

  it("兌獎:刷背面編號 → 預覽;選金額 → 確認;提示「已兌獎」與 [撤銷],不自動打開 [最近兌獎];[撤銷] → 確認視窗", async () => {
    const { user, redemptions } = renderStore();
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "兌獎" }));
    const dialog = await screen.findByRole("dialog", {
      name: "兌獎 · 店內櫃台",
    });
    // 每個按鍵同一個時間 = 條碼槍的速度(CI 機器快時 user.type 就是這樣):編號欄自己處理,不交給看板的銷售
    const now = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    await user.type(
      within(dialog).getByRole("textbox", { name: "刷背面編號" }),
      "5164-1-056527-099-0-6{Enter}",
    );
    now.mockRestore();
    expect(await within(dialog).findByText("5164 發大財")).toBeInTheDocument();
    expect(
      within(dialog).getByText("本號 056527 · 張號 099 · 本店的刮刮樂"),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "500" }));
    await user.click(within(dialog).getByRole("button", { name: "確認兌獎" }));
    expect(redemptions.inputs.redeem).toEqual([
      {
        shiftId: "shift-counter",
        code: "5164-1-056527-099-0-6",
        prizeAmount: 500,
      },
    ]);
    expect(await screen.findByText("已兌獎")).toBeInTheDocument();
    expect(
      screen.getByText("RD-0219 · 5164-056527-099 · 500 元 · 店內櫃台"),
    ).toBeInTheDocument();
    expect(screen.queryByText("最近兌獎 · 店內櫃台")).toBeNull();

    await user.click(screen.getByRole("button", { name: "撤銷" }));
    const confirm = await screen.findByRole("dialog", { name: "撤銷兌獎?" });
    expect(
      within(confirm).getByText("撤銷後 500 元退回店內櫃台的抽屜應有金額。"),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "撤銷" }));
    await waitFor(() => {
      expect(redemptions.inputs.revoke).toEqual([{ id: "rd-new-1" }]);
    });
  });

  it("編號看不懂(api 指到編號)→ 編號欄下寫原因,下方提示只放通用句(REACT-18)", async () => {
    const { user } = renderStore();
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "兌獎" }));
    const dialog = await screen.findByRole("dialog", {
      name: "兌獎 · 店內櫃台",
    });
    const code = within(dialog).getByRole("textbox", { name: "刷背面編號" });
    await user.type(code, "abc{Enter}");
    await waitFor(() => {
      expect(code).toHaveAccessibleDescription("看不懂這個編號,請刷背面編號");
    });
    expect(
      within(dialog).getByText("有欄位不正確,請檢查標紅的欄位"),
    ).toBeInTheDocument();
  });

  it("api 只指到編號、沒有細分原因(格式錯)→ 編號欄下寫格式要求,不寫通用句", async () => {
    const { user } = renderStore();
    server.use(
      api.query("LotteryRedemptionPreview", () =>
        graphqlError("VALIDATION_FAILED", "VALIDATION_FAILED", {
          code: "VALIDATION_FAILED",
          fields: ["code"],
        }),
      ),
    );
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "兌獎" }));
    const dialog = await screen.findByRole("dialog", {
      name: "兌獎 · 店內櫃台",
    });
    const code = within(dialog).getByRole("textbox", { name: "刷背面編號" });
    await user.type(code, "abc{Enter}");
    await waitFor(() => {
      expect(code).toBeInvalid();
    });
    expect(code).toHaveAccessibleDescription(
      "條碼槍刷背面編號,或輸入後按 Enter",
    );
  });

  it("單張超過 5,000 → 畫面先擋、[確認兌獎] 停用;已兌過的張 → 提示時間與收銀點", async () => {
    const { user } = renderStore();
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "兌獎" }));
    const dialog = await screen.findByRole("dialog", {
      name: "兌獎 · 店內櫃台",
    });
    await user.type(
      within(dialog).getByRole("textbox", { name: "刷背面編號" }),
      "5164-1-056527-031-0-6{Enter}",
    );
    expect(
      await within(dialog).findByText(/這張已兌過獎\(.* 店內櫃台\)/),
    ).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole("textbox", { name: "中獎金額" }),
      "10000",
    );
    expect(
      within(dialog).getByText("單張超過 5,000 元:請客人到銀行兌獎"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "確認兌獎" }),
    ).toBeDisabled();
  });

  it("[最近兌獎]:自己在這一班登記的(已撤銷的標「已撤銷」);撤銷後清單不關、那一筆改「已撤銷」", async () => {
    const { user, redemptions } = renderStore();
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "最近兌獎" }));
    const drawer = await recentDrawer();
    const table = await within(drawer).findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("已撤銷")).toBeInTheDocument();
    // 每列刮刮樂下方是單號
    expect(within(table).getByText("RD-0218")).toBeInTheDocument();
    const buttons = within(table).getAllByRole("button", { name: "撤銷" });
    await user.click(buttons.at(0) ?? table);
    const confirm = await screen.findByRole("dialog", { name: "撤銷兌獎?" });
    await user.click(within(confirm).getByRole("button", { name: "撤銷" }));
    await waitFor(() => {
      expect(redemptions.inputs.revoke).toEqual([{ id: "rd-031" }]);
    });
    await waitFor(() => {
      expect(within(table).getAllByText("已撤銷")).toHaveLength(2);
    });
    expect(screen.getByText("最近兌獎 · 店內櫃台")).toBeInTheDocument();
  });

  it("兌獎紀錄分頁:列表(單號欄;舊資料「—」);已送兌 → 詳情的 [撤銷兌獎] 停用並提示先撤回或退回進貨單", async () => {
    const { user } = renderStore({ path: "/store?tab=redemptions" });
    const table = await screen.findByRole("table", { name: "兌獎紀錄" });
    expect(
      await within(table).findByText("5150-042210-083"),
    ).toBeInTheDocument();
    expect(within(table).getByText("RD-0215")).toBeInTheDocument();
    // rd-012 是加單號之前的舊資料:單號欄與進貨單欄都是「—」
    const legacy = within(table).getByText("5164-056527-012").closest("tr");
    expect(legacy).not.toBeNull();
    expect(within(legacy ?? table).getAllByText("—")).toHaveLength(2);
    await user.click(within(table).getByText("5150-042210-083"));
    const dialog = await screen.findByRole("dialog", { name: /^兌獎紀錄/ });
    // 標題列右側是單號(Figma ST-39a)
    expect(within(dialog).getByText("RD-0215")).toBeInTheDocument();
    expect(
      await within(dialog).findByText("已送兌(進貨單 P-0033)"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "撤銷兌獎" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText("已送兌,不能撤銷;要先撤回或退回進貨單 P-0033。"),
    ).toBeInTheDocument();
  });

  it("已交班 / 別人登記:店長撤銷要原因;[撤銷並重新登記] 接著開兌獎視窗,一起送出", async () => {
    const { user, redemptions } = renderStore({
      path: "/store?tab=redemptions",
    });
    const table = await screen.findByRole("table", { name: "兌獎紀錄" });
    await user.click(await within(table).findByText("5164-056527-012"));
    const detail = await screen.findByRole("dialog", { name: /^兌獎紀錄/ });
    await user.click(
      await within(detail).findByRole("button", { name: "撤銷兌獎" }),
    );
    const revoke = await screen.findByRole("dialog", { name: "撤銷兌獎" });
    expect(
      within(revoke).getByText(
        "這一班已結帳:撤銷後記成那一班的事後更正,應有現金 +1,000。",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(revoke).getByRole("button", { name: "撤銷並重新登記" }),
    );
    expect(
      within(revoke).getByRole("combobox", { name: "撤銷原因(必填)" }),
    ).toHaveAttribute("aria-invalid", "true");
    await user.click(
      within(revoke).getByRole("combobox", { name: "撤銷原因(必填)" }),
    );
    await user.click(await screen.findByRole("option", { name: "登記錯誤" }));
    await user.click(
      within(revoke).getByRole("button", { name: "撤銷並重新登記" }),
    );
    const replace = await screen.findByRole("dialog", {
      name: "重新登記 · 店外攤位",
    });
    await user.type(
      within(replace).getByRole("textbox", { name: "刷背面編號" }),
      "5164-1-056527-012-0-6{Enter}",
    );
    await user.type(
      within(replace).getByRole("textbox", { name: "中獎金額" }),
      "200",
    );
    await user.click(
      within(replace).getByRole("button", { name: "撤銷並重新登記" }),
    );
    await waitFor(() => {
      expect(redemptions.inputs.replace).toEqual([
        {
          id: "rd-012",
          reasonKey: "entry-error",
          reasonNote: null,
          code: "5164-1-056527-012-0-6",
          prizeAmount: 200,
        },
      ]);
    });
  });

  it("沒有權限(api 回 revokeMode = null)→ 詳情與 [最近兌獎] 都看不到撤銷按鈕", async () => {
    const rows: RedemptionFixture[] = sampleRedemptions().map((row) => ({
      ...row,
      revokeMode: null,
    }));
    rows.push(
      redemptionRow({
        id: "rd-none",
        gameCode: "5164",
        bookNo: "0056527",
        ticketNo: "050",
        prizeAmount: 300,
        redeemedAt: "2026-10-16T13:55:00.000Z",
        revokeMode: null,
      }),
    );
    const { user } = renderStore({ redemptionRows: rows });
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "最近兌獎" }));
    const drawer = await recentDrawer();
    const table = await within(drawer).findByRole("table");
    expect(within(table).queryByRole("button", { name: "撤銷" })).toBeNull();
    await user.click(within(table).getByText("5164 · 056527 · #050"));
    const detail = await screen.findByRole("dialog", { name: /^兌獎紀錄/ });
    expect(await within(detail).findByText("300 元")).toBeInTheDocument();
    expect(
      within(detail).queryByRole("button", { name: "撤銷兌獎" }),
    ).toBeNull();
  });

  it("兌獎紀錄分頁的篩選在網址(`?redemptions=`):狀態 = 已送兌 → 只列已送兌的", async () => {
    const filters = encodeURIComponent(
      JSON.stringify({
        from: "",
        to: "",
        cashPointId: "all",
        status: "sent",
        redeemedBy: "all",
        page: 1,
      }),
    );
    renderStore({ path: `/store?tab=redemptions&redemptions=${filters}` });
    const table = await screen.findByRole("table", { name: "兌獎紀錄" });
    expect(
      await within(table).findByText("5150-042210-083"),
    ).toBeInTheDocument();
    expect(within(table).queryByText("5164-056527-031")).toBeNull();
    expect(screen.getByText("共 1 筆")).toBeInTheDocument();
  });

  it("兌獎紀錄分頁的單號搜尋:輸入 218 → 只列 RD-0218,寫進網址 `?redemptions=`", async () => {
    const { user } = renderStore({ path: "/store?tab=redemptions" });
    const table = await screen.findByRole("table", { name: "兌獎紀錄" });
    expect(await within(table).findByText("RD-0215")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "單號" }), "218");
    await waitFor(() => {
      expect(within(table).queryByText("RD-0215")).toBeNull();
    });
    expect(within(table).getByText("RD-0218")).toBeInTheDocument();
    expect(screen.getByText("共 1 筆")).toBeInTheDocument();
  });

  it("單號搜尋不限期間:期間是 9 月(沒有紀錄)時輸入 RD-0218 仍找得到;提示「輸入單號時不限期間」", async () => {
    const filters = encodeURIComponent(
      JSON.stringify({
        from: "2026-09-01",
        to: "2026-09-30",
        cashPointId: "all",
        status: "all",
        redeemedBy: "all",
        serialNo: "",
        page: 1,
      }),
    );
    const { user } = renderStore({
      path: `/store?tab=redemptions&redemptions=${filters}`,
    });
    const table = await screen.findByRole("table", { name: "兌獎紀錄" });
    expect(await screen.findByText("共 0 筆")).toBeInTheDocument();
    expect(screen.getByText("輸入單號時不限期間")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "單號" }), "RD-0218");
    expect(await within(table).findByText("RD-0218")).toBeInTheDocument();
    expect(screen.getByText("共 1 筆")).toBeInTheDocument();
  });

  it("兌獎視窗開著時刷條碼(條碼槍 / 相機)→ 交給兌獎(填進編號並預覽),不會被看板的銷售吃掉", async () => {
    const { user, salesFake } = renderStore();
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "兌獎" }));
    const dialog = await screen.findByRole("dialog", {
      name: "兌獎 · 店內櫃台",
    });
    act(() => {
      injectScan("5164-1-056527-099-0-6");
    });
    expect(await within(dialog).findByText("5164 發大財")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("textbox", { name: "刷背面編號" }),
    ).toHaveValue("5164-1-056527-099-0-6");
    expect(salesFake.inputs.sell).toEqual([]);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
