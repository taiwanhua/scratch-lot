import { beforeEach, describe, expect, it } from "@jest/globals";
import { act, screen, waitFor, within } from "@testing-library/react";

import {
  STORE_PERMISSIONS,
  parseStocktakeDraft,
} from "@repo/domain/project/lottery";

import { injectScan } from "@/hooks/project/useScanner/scanner-registry";
import { STORE_ALL_PERMISSIONS } from "@/test/msw/project/lottery/store-fixtures";

import { fastUser } from "../../../schedule/manage/roster/roster-test-queries";
import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";
/** 店外攤位(13:00 的班已結帳)的臨時盤點:兩本(5164 · 056528、5133 · 071204)。 */
const OUTDOOR_PATH = `/store/create-page/stocktake_confirm?org=${STORE_A}&scope=cp-outdoor`;

const cell = (label: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(
    `[aria-label="${CSS.escape(label)}"]`,
  );
  if (found === null) {
    throw new Error(`沒有格子 ${label}`);
  }
  return found;
};

const rowOf = (ticketNo: string): HTMLElement => {
  const found = screen.getByText(`#${ticketNo}`, { selector: "td" });
  const row = found.closest("tr");
  if (row === null) {
    throw new Error(`沒有 #${ticketNo} 那一列`);
  }
  return row;
};

/** 5133 招財貓 · 本號 071204:#001–015 已售、#016–025 未售。點 #016–023 在、#015(已售)在,#024、#025 不在。 */
const countZhaoCaiMao = async (user: ReturnType<typeof fastUser>) => {
  const item = await screen.findByText("5133 招財貓", { selector: "p" });
  await user.click(item);
  await screen.findByRole("heading", { name: "5133 招財貓 · 本號 071204" });
  for (const no of [
    "015",
    "016",
    "017",
    "018",
    "019",
    "020",
    "021",
    "022",
    "023",
  ]) {
    const label = no === "015" ? `#${no} 已售` : `#${no} 未售`;
    await user.click(cell(label));
  }
};

/**
 * 盤點(規格 6.8、8.6;Figma ST-13 / 14 / 15 / 16 / 29 / 30):看板的 [盤點] 與提醒、選範圍、盤點頁(點格子、刷條碼)、
 * 差異核對([補登售出] 立即生效、已被處理的提示、待查 / 標記異常)、送出盤點確認申請、盤點紀錄、檢視頁、沒有權限時。
 */
describe("店面管理:盤點", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("看板:[盤點] 與「建議盤點一次」;選全店 → 盤點頁(臨時盤點 · 全店,未拆的本、待查清單)", async () => {
    const user = fastUser();
    renderStore();
    expect(
      await screen.findByText("距離上次盤點已超過 24 小時,建議盤點一次"),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "盤點" }));
    const dialog = await screen.findByRole("dialog", {
      name: "開始盤點(臨時)",
    });
    await user.click(within(dialog).getByRole("button", { name: "開始盤點" }));
    expect(
      await screen.findByRole("heading", { name: "臨時盤點 · 全店" }),
    ).toBeInTheDocument();
    expect(screen.getByText("未拆的本(在 / 不在)")).toBeInTheDocument();
    expect(screen.getByText("待查清單")).toBeInTheDocument();
    expect(screen.getByText("5164 · 056420 · 整本")).toBeInTheDocument();
    // 店外攤位沒有開著的班:[補登兌獎] 停用並說明
    expect(
      screen.getAllByRole("button", { name: "補登兌獎" }).at(1),
    ).toBeDisabled();
    expect(screen.getByText("這個收銀點沒有開著的班")).toBeInTheDocument();
  });

  it("沒有 store.stocktake → 看板沒有 [盤點];沒有 confirm-lost → 待查清單沒有「確認遺失」", async () => {
    renderStore({
      permissions: STORE_ALL_PERMISSIONS.filter(
        (key) => key !== STORE_PERMISSIONS.stocktake,
      ),
    });
    await screen.findByText("店內櫃台");
    expect(screen.queryByRole("button", { name: "盤點" })).toBeNull();
  });

  it("沒有 confirm-lost:待查清單的處理只有「找到了」「繼續待查」", async () => {
    const user = fastUser();
    renderStore({
      path: `/store/create-page/stocktake_confirm?org=${STORE_A}`,
      permissions: STORE_ALL_PERMISSIONS.filter(
        (key) => key !== STORE_PERMISSIONS.confirmLost,
      ),
    });
    await screen.findByText("待查清單");
    await user.click(screen.getAllByRole("combobox", { name: "處理" })[0]);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "找到了(刷條碼)",
      "繼續待查",
    ]);
  });

  it("盤點中刷條碼記為「在」,不會被當成售出", async () => {
    const { salesFake } = renderStore({ path: OUTDOOR_PATH });
    const user = fastUser();
    await screen.findByRole("heading", { name: "臨時盤點 · 店外攤位" });
    await user.click(await screen.findByText("5133 招財貓", { selector: "p" }));
    act(() => {
      injectScan("0071204016");
    });
    await waitFor(() => {
      expect(cell("#016 在(已點)")).toHaveAttribute("aria-pressed", "true");
    });
    expect(salesFake.inputs.sell).toHaveLength(0);
  });

  it("差異核對:[補登售出] 立即生效(已結帳 → 事後更正)、待查、標記異常;送出盤點確認申請帶盤點內容", async () => {
    const user = fastUser();
    const { stocktake, runtime } = renderStore({ path: OUTDOOR_PATH });
    await countZhaoCaiMao(user);
    expect(screen.getByText("3 張:#015、#024–025")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "差異核對 →" }));

    await screen.findByText("#024", { selector: "td" });
    await user.click(
      within(rowOf("024")).getByRole("button", { name: "補登售出" }),
    );
    await waitFor(() => {
      expect(stocktake.inputs.backfill).toHaveLength(1);
    });
    expect(
      await within(rowOf("024")).findByText("已補登售出(立即生效)"),
    ).toBeInTheDocument();
    expect(
      within(rowOf("024")).getByText("記成店外攤位最近一班的事後更正 +1,000"),
    ).toBeInTheDocument();
    await user.click(
      within(rowOf("025")).getByRole("button", { name: "待查" }),
    );
    await user.click(
      within(rowOf("015")).getByRole("button", { name: "標記異常" }),
    );
    const submit = screen.getByRole("button", { name: "送出 →" });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await user.click(submit);
    const dialog = await screen.findByRole("dialog", { name: /送出盤點?/u });
    expect(
      within(dialog).getByText(
        "還有 1 本沒有盤;沒盤的本不比對,盤點單會記下未盤的本。",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "送出盤點確認申請" }),
    );
    await waitFor(() => {
      expect(runtime.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    const sent = runtime.inputs.createAndSubmitFormSubmission.at(0);
    const values = sent?.values ?? {};
    expect(sent).toMatchObject({
      formKey: "stocktake_confirm",
      values: { branch: STORE_A, scope_label: "店外攤位" },
    });
    const parsed = parseStocktakeDraft(values.draft);
    expect(parsed.ok && parsed.draft.lines).toEqual([
      expect.objectContaining({
        bookId: "b-6",
        cashPointId: "cp-outdoor",
        diffs: expect.arrayContaining([
          { ticketNo: "024", action: "sale_backfill", eventId: "b-6-024:2" },
          { ticketNo: "025", action: "investigate", eventId: null },
          { ticketNo: "015", action: "flag", eventId: null },
        ]),
      }),
    ]);
  });

  it("補登售出時已被處理(兩人同時補登 / 看板補刷)→ 提示「這幾張已被處理,請重新核對」", async () => {
    const user = fastUser();
    renderStore({
      path: OUTDOOR_PATH,
      stocktakeOptions: { processedTicketIds: ["b-6-024"] },
    });
    await countZhaoCaiMao(user);
    await user.click(screen.getByRole("button", { name: "差異核對 →" }));
    await screen.findByText("#024", { selector: "td" });
    await user.click(
      within(rowOf("024")).getByRole("button", { name: "補登售出" }),
    );
    expect(
      await screen.findByText("這幾張已被處理,請重新核對"),
    ).toBeInTheDocument();
  });

  it("沒有 store.sell → 差異核對沒有 [補登售出]", async () => {
    const user = fastUser();
    renderStore({
      path: OUTDOOR_PATH,
      permissions: STORE_ALL_PERMISSIONS.filter(
        (key) => key !== STORE_PERMISSIONS.sell,
      ),
    });
    await countZhaoCaiMao(user);
    await user.click(screen.getByRole("button", { name: "差異核對 →" }));
    await screen.findByText("#024", { selector: "td" });
    expect(
      within(rowOf("024")).queryByRole("button", { name: "補登售出" }),
    ).toBeNull();
    expect(
      within(rowOf("024")).getByRole("button", { name: "待查" }),
    ).toBeInTheDocument();
  });

  it("盤點紀錄分頁(ST-29)點一列 → 盤點確認申請檢視頁(ST-30)", async () => {
    const user = fastUser();
    renderStore({ path: "/store?tab=stocktakes" });
    const serial = await screen.findByText("S-0032");
    expect(screen.getByText("待核准")).toBeInTheDocument();
    expect(screen.getByText("2 張 · 300")).toBeInTheDocument();
    // 沒盤完送出的那一筆在狀態旁標「N 本未盤」;盤完的沒有標
    expect(screen.getAllByText("3 本未盤")).toHaveLength(1);
    await user.click(serial);
    expect(
      await screen.findByRole("heading", { name: "盤點確認申請 S-0032" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("5198 鼠來寶 · 088102")).toBeInTheDocument();
    expect(screen.getByText("補登售出 1、待查 1")).toBeInTheDocument();
    expect(screen.getByText("補登售出(事後更正)")).toBeInTheDocument();
    expect(screen.getByText("2 張 · 300 元")).toBeInTheDocument();
    // 檢視頁列出未盤的本(遊戲、本號、收銀點)與彙總
    expect(
      screen.getByText("未盤的本", { selector: "h6" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 本未盤")).toBeInTheDocument();
    expect(
      screen.getByText("5164 發大財 · 056527 · 店內櫃台"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("5133 招財貓 · 071204 · 店外攤位"),
    ).toBeInTheDocument();
    expect(screen.getByText("3 本")).toBeInTheDocument();
  });

  it("待查清單「找到了」要刷條碼:整本都待查的刷一張就整本找到;零碎的只算刷到的張,其他維持待查", async () => {
    const user = fastUser();
    const { stocktake } = renderStore({
      path: `/store/create-page/stocktake_confirm?org=${STORE_A}`,
    });
    await screen.findByText("5201 · 060090 · #023–024");
    act(() => {
      injectScan("0060090023");
    });
    expect(
      await screen.findByText("已刷到 1 / 2 張;沒刷到的維持待查"),
    ).toBeInTheDocument();
    act(() => {
      injectScan("0056420002");
    });
    expect(await screen.findByText("已刷到,找到了")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一本" }));
    await user.click(screen.getByRole("button", { name: "差異核對 →" }));
    await waitFor(() => {
      expect(stocktake.inputs.reviews.length).toBeGreaterThan(0);
    });
    const draft = stocktake.inputs.reviews.at(-1);
    expect(
      draft?.lostReview
        .filter((item) => item.action === "found")
        .map((item) => item.ticketId)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["b-l1-001", "b-l1-002", "b-l1-003", "b-l2-023"]);
  });
});
