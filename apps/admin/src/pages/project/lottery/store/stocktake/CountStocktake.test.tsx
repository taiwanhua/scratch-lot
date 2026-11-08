import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import {
  STORE_PERMISSIONS,
  parseStocktakeDraft,
} from "@repo/domain/project/lottery";

import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";
import { sampleStocktakeSession } from "@/test/msw/project/lottery/stocktake-handlers";
import { STORE_ALL_PERMISSIONS } from "@/test/msw/project/lottery/store-fixtures";

import { fastUser } from "../../../schedule/manage/roster/roster-test-queries";
import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";
const WHOLE_STORE_PATH = `/store/create-page/stocktake_confirm?org=${STORE_A}`;
const COUNTER_PATH = `${WHOLE_STORE_PATH}&scope=cp-counter`;
const OUTDOOR_PATH = `${WHOLE_STORE_PATH}&scope=cp-outdoor`;
const CHECKOUT_PATH = `/store/create-page/checkout_confirm?org=${STORE_A}&shift=shift-counter`;

/** 一張卡片(文字所在的那張)。 */
const cardOf = (element: HTMLElement): HTMLElement => {
  const card = element.closest<HTMLElement>("[class*='MuiCard']");
  if (card === null) {
    throw new Error("找不到卡片");
  }
  return card;
};

/** 張數盤點:在「實際剩幾張」輸入後按 [確定]。 */
const countGroup = async (
  user: ReturnType<typeof fastUser>,
  present: number,
) => {
  const input = await screen.findByRole("textbox", { name: "實際剩幾張" });
  await user.type(input, String(present));
  await user.click(screen.getByRole("button", { name: "確定" }));
};

/**
 * 張數盤點(張數店規格 8.1、8.2、8.5a、13.1、13.3;16.7 S8、S9、S10;Figma CS-09a~d、CS-12、ST-01-2、ST-13-2a~d、
 * ST-13-3a / 3b、ST-17a-2a / 2b):盲數輸入、[確定] 後才顯示系統數字、[重數];[上一組] [下一組] 的按鈕規則;
 * 差異核對 [算售出] / [待查] / [標記異常]、要重數的組;盤點中登記(倒數、[繼續] [放棄]、被擋、店長結束);
 * 全店盤點中交班被擋;張數店交班沒有 [跳過]。
 */
describe("店面管理:張數盤點與盤點中登記", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("CS-09a / 09b:數之前不顯示系統數字;[確定] 後「系統 12 · 實際 11 · 少 1 張」、[重數];S8 [上一組] 第一組停用,[下一組] 跳到下一組還沒數的,最後 → [盤完,前往差異核對]", async () => {
    const user = fastUser();
    renderStore({ path: COUNTER_PATH, stocktakeOptions: { countMode: true } });
    expect(
      await screen.findByRole("heading", { name: "5164 發大財 · 店內櫃台" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/系統 12/u)).toBeNull();
    expect(screen.getByRole("button", { name: "上一組" })).toBeDisabled();
    await countGroup(user, 11);
    expect(screen.getByText("系統 12 · 實際 11 · 少 1 張")).toBeInTheDocument();
    expect(screen.getByText("已數 1 / 2 組")).toBeInTheDocument();
    // [重數]:清掉這一次的數字,重新輸入
    await user.click(screen.getByRole("button", { name: "重數" }));
    await countGroup(user, 12);
    expect(
      screen.getByText("系統 12 · 實際 12 · 沒有差異"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "下一組" }));
    expect(
      await screen.findByRole("heading", { name: "5201 金好運 · 店內櫃台" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一組" })).toBeEnabled();
    await countGroup(user, 35);
    await user.click(screen.getByRole("button", { name: "盤完,前往差異核對" }));
    expect(
      await screen.findByRole("heading", { name: "差異核對" }),
    ).toBeInTheDocument();
  });

  it("S8 編號店(ST-13-3a / 3b):[上一本] 外框按鈕、第一本停用不隱藏;[下一本] 記成已盤後跳下一本,最後一本是 [盤完,前往差異核對]", async () => {
    const user = fastUser();
    renderStore({ path: OUTDOOR_PATH });
    await screen.findByRole("heading", { name: "5164 發大財 · 本號 056528" });
    expect(screen.getByRole("button", { name: "上一本" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "下一本" }));
    await screen.findByRole("heading", { name: "5133 招財貓 · 本號 071204" });
    expect(screen.getByRole("button", { name: "上一本" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "盤完,前往差異核對" }));
    expect(
      await screen.findByRole("heading", { name: "差異核對" }),
    ).toBeInTheDocument();
  });

  it("S2 差異核對:少 → [算售出](立即生效)/ [待查];多 → [標記異常];送出的盤點內容帶組、每次輸入與算售出 id(CS-09c / 09d)", async () => {
    const user = fastUser();
    const { stocktake, runtime } = renderStore({
      path: WHOLE_STORE_PATH,
      stocktakeOptions: { countMode: true },
    });
    await screen.findByRole("heading", { name: "5164 發大財 · 店內櫃台" });
    await countGroup(user, 10);
    await user.click(screen.getByRole("button", { name: "下一組" }));
    await screen.findByRole("heading", { name: "5201 金好運 · 店內櫃台" });
    await countGroup(user, 36);
    await user.click(screen.getByRole("button", { name: "下一組" }));
    await screen.findByRole("heading", { name: "5133 招財貓 · 店外攤位" });
    await countGroup(user, 10);
    await user.click(screen.getByRole("button", { name: "差異核對 →" }));

    const shortCard = await screen.findByText("店內櫃台 · 5164 發大財");
    const short = cardOf(shortCard);
    // 少 2 張:拆開 → 算售出 1、待查 1
    await user.click(within(short).getByRole("button", { name: "拆開" }));
    await user.type(
      within(short).getByRole("textbox", { name: "算售出幾張(最多 1)" }),
      "1",
    );
    await user.click(within(short).getByRole("button", { name: "套用" }));
    await waitFor(() => {
      expect(stocktake.inputs.countBackfill).toEqual([
        {
          orgId: STORE_A,
          cashPointId: "cp-counter",
          gameId: "g-5164",
          count: 1,
        },
      ]);
    });
    expect(
      await within(short).findByText(
        "算售出 1 張:算進店內櫃台這一班,應有現金 +200(張號系統預設帶入);待查 1 張(系統預設帶入,責任分店 = 中山店)",
      ),
    ).toBeInTheDocument();
    const overCard = screen.getByText("店內櫃台 · 5201 金好運");
    const over = cardOf(overCard);
    await user.click(within(over).getByRole("button", { name: "標記異常" }));
    expect(
      within(over).getByText(/標記異常:張的狀態不動,觸發全店重刷 \d+ 提醒/),
    ).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "送出 →" });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await user.click(submit);
    const dialog = await screen.findByRole("dialog", { name: /送出盤點?/u });
    expect(
      within(dialog).getByText("1 張(5164 · 店內櫃台 1 張 · 系統預設帶入)"),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "送出盤點確認申請" }),
    );
    await waitFor(() => {
      expect(runtime.inputs.createAndSubmitFormSubmission).toHaveLength(1);
    });
    const parsed = parseStocktakeDraft(
      runtime.inputs.createAndSubmitFormSubmission.at(0)?.values?.draft,
    );
    expect(parsed.ok && parsed.draft).toMatchObject({
      countMode: "count",
      countLines: [
        {
          gameId: "g-5164",
          presentCount: 10,
          saleCount: 1,
          saleRefIds: ["count-sale-1"],
          investigateCount: 1,
          flagged: false,
        },
        { gameId: "g-5201", presentCount: 36, flagged: true },
        { gameId: "g-5133", presentCount: 10 },
      ],
    });
  });

  it("S10 B6:開始數之後被別張盤點處理過的組 → 「請重新數這一組」、不能送出,[重數這組] 回到那一組", async () => {
    const user = fastUser();
    renderStore({
      path: OUTDOOR_PATH,
      stocktakeOptions: { countMode: true, staleGroups: ["cp-outdoor:g-5133"] },
    });
    await screen.findByRole("heading", { name: "5133 招財貓 · 店外攤位" });
    await countGroup(user, 9);
    await user.click(screen.getByRole("button", { name: "盤完,前往差異核對" }));
    expect(
      await screen.findByText(
        "遊戲 5133 招財貓 在店外攤位剛被別的盤點或重刷處理過,請重新數這一組。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "送出 →" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重數這組" }));
    expect(
      await screen.findByRole("textbox", { name: "實際剩幾張" }),
    ).toHaveValue("");
  });

  it("檢視頁:張數盤點每一組的系統 / 實際(含「第一次數 11、改成 10」)、算售出 / 待查 / 標記異常、還沒數的組", async () => {
    const user = fastUser();
    renderStore({
      path: "/store?tab=stocktakes",
      stocktakeOptions: { countMode: true },
    });
    await user.click(await screen.findByText("ST-0032"));
    expect(await screen.findByText("張數盤點")).toBeInTheDocument();
    expect(screen.getByText("第一次數 11、改成 10")).toBeInTheDocument();
    expect(
      screen.getByText("算售出 1 張 · 200 元;待查 1 張(系統預設帶入)"),
    ).toBeInTheDocument();
    expect(screen.getByText("標記異常 1 張")).toBeInTheDocument();
    expect(
      screen.getByText("還沒數:店外攤位 · 5133 招財貓"),
    ).toBeInTheDocument();
  });

  it("待查清單:待查·未對號一組「5164 · 2 張 · 系統預設帶入」只有 [確認遺失]、[繼續待查]", async () => {
    const user = fastUser();
    renderStore({
      path: WHOLE_STORE_PATH,
      stocktakeOptions: { countMode: true },
    });
    const label = await screen.findByText("5164 · 2 張 · 系統預設帶入");
    const row = label.parentElement?.parentElement ?? label;
    expect(
      within(row).getByText("10/16 交班盤點 · 店內櫃台"),
    ).toBeInTheDocument();
    await user.click(within(row).getByRole("combobox", { name: "處理" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "確認遺失(原因必填)",
      "繼續待查",
    ]);
  });

  it("S9 盤點中登記(ST-13-2a):進來就登記、倒數「剩 60 分鐘」,每次變動存進度;[取消(不保留)] = 放棄", async () => {
    const user = fastUser();
    const { stocktake } = renderStore({
      path: COUNTER_PATH,
      stocktakeOptions: { countMode: true },
    });
    expect(
      await screen.findByText(/剩 60 分鐘自動結束\(有操作就重算\)/u),
    ).toBeInTheDocument();
    expect(stocktake.inputs.sessionStarts).toEqual([
      expect.objectContaining({ type: "adhoc", cashPointId: "cp-counter" }),
    ]);
    await countGroup(user, 11);
    await waitFor(() => {
      expect(stocktake.inputs.sessionSaves.length).toBeGreaterThan(0);
    });
    const saved = parseStocktakeDraft(
      stocktake.inputs.sessionSaves.at(-1)?.draft,
    );
    expect(saved.ok && saved.draft.countLines).toEqual([
      expect.objectContaining({ gameId: "g-5164", presentCount: 11 }),
    ]);
    await user.click(screen.getByRole("button", { name: "取消(不保留)" }));
    await waitFor(() => {
      expect(stocktake.inputs.sessionEnds).toHaveLength(1);
    });
  });

  it("S9 重新整理後(ST-13-2b):你有一個進行中的盤點 → [繼續] 還原已數的組與開始數的時間", async () => {
    const user = fastUser();
    const progress = JSON.stringify({
      version: 1,
      orgId: STORE_A,
      scopeCashPointId: "cp-counter",
      startedAt: "2026-10-16T02:05:00.000Z",
      lines: [],
      unopened: [],
      lostReview: [],
      countMode: "count",
      purpose: "normal",
      countLines: [
        {
          gameId: "g-5164",
          cashPointId: "cp-counter",
          countedAt: "2026-10-16T02:06:00.000Z",
          presentCount: 11,
          recounts: [12],
          saleCount: 0,
          saleRefIds: [],
          investigateCount: 0,
          flagged: false,
        },
      ],
    });
    const { stocktake } = renderStore({
      path: COUNTER_PATH,
      stocktakeOptions: {
        countMode: true,
        sessions: [
          sampleStocktakeSession({
            sessionId: "mine",
            byName: "王小明",
            mine: true,
            draft: progress,
          }),
        ],
      },
    });
    const dialog = await screen.findByRole("dialog", {
      name: "你有一個進行中的盤點",
    });
    expect(
      within(dialog).getByText(/臨時盤點 · 店內櫃台 · \d{2}:\d{2} 開始/u),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "繼續" }));
    expect(
      await screen.findByText(/系統 12 · 實際 11 · 少 1 張/u),
    ).toBeInTheDocument();
    expect(stocktake.inputs.sessionStarts).toEqual([
      expect.objectContaining({ sessionId: "mine" }),
    ]);
    await waitFor(() => {
      const saved = stocktake.inputs.sessionSaves.at(-1);
      const parsed = parseStocktakeDraft(saved?.draft);
      expect(parsed.ok && parsed.draft.countLines?.[0]).toMatchObject({
        countedAt: "2026-10-16T02:06:00.000Z",
        recounts: [12],
      });
    });
  });

  it("S9 看板:同位置有人在盤點 → 「不能開始盤點」(誰、幾點開始、剩幾分鐘);店長 [結束這個盤點] 確認後解除(ST-13-2c / 2d)", async () => {
    const user = fastUser();
    const { stocktake } = renderStore({
      stocktakeOptions: {
        sessions: [
          sampleStocktakeSession({
            canEnd: true,
            wholeStore: true,
            cashPointId: null,
            cashPointName: null,
          }),
        ],
      },
    });
    await user.click(await screen.findByRole("button", { name: "盤點" }));
    const scope = await screen.findByRole("dialog", {
      name: "開始盤點(臨時)",
    });
    await user.click(within(scope).getByRole("button", { name: "開始盤點" }));
    const blocked = await screen.findByRole("dialog", {
      name: "不能開始盤點",
    });
    expect(
      within(blocked).getByText(
        /全店正在由李小華盤點\(\d{2}:\d{2} 開始,剩 52 分鐘自動結束\),請等他送出。/u,
      ),
    ).toBeInTheDocument();
    await user.click(
      within(blocked).getByRole("button", { name: "結束這個盤點" }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: "結束李小華的盤點?",
    });
    await user.click(
      within(confirm).getByRole("button", { name: "結束這個盤點" }),
    );
    await waitFor(() => {
      expect(stocktake.inputs.sessionEnds).toEqual([
        { orgId: STORE_A, sessionId: "session-li" },
      ]);
    });
  });

  it("ST-01-2:全店盤點中 → 看板頂部提示、[交班結帳] 停用", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    renderStore({
      stocktakeOptions: {
        sessions: [
          sampleStocktakeSession({
            byName: "王小明",
            wholeStore: true,
            cashPointId: null,
            cashPointName: null,
          }),
        ],
      },
    });
    expect(
      await screen.findByText(
        /全店盤點中\(王小明,\d{2}:\d{2} 開始\),請等送出後再交班。/u,
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "交班結帳" }),
    ).toBeDisabled();
  });

  it("CS-12 / ST-17a-2a:張數店交班沒有 [跳過](有跳過權限也一樣);選現在盤點被擋 → 誰在盤、剩幾分鐘", async () => {
    renderStore({
      path: CHECKOUT_PATH,
      permissions: [...STORE_ALL_PERMISSIONS, STORE_PERMISSIONS.skipStocktake],
      checkoutOptions: {
        wizard: { canSkipStocktake: false, reusableStocktake: null },
      },
      stocktakeOptions: {
        countMode: true,
        sessions: [sampleStocktakeSession({ type: "adhoc" })],
      },
    });
    expect(
      await screen.findByRole("radio", { name: "現在盤點" }),
    ).toBeChecked();
    expect(screen.queryByRole("radio", { name: "跳過盤點" })).toBeNull();
    expect(
      await screen.findByText(
        /店內櫃台正在由李小華盤點\(\d{2}:\d{2} 開始,剩 52 分鐘自動結束\),請等他送出。/u,
      ),
    ).toBeInTheDocument();
  });
});
