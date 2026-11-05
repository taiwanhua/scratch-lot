import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { RESCAN_REASONS } from "@repo/domain/project/lottery";

import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";
import {
  rescanItem,
  rescanReminder,
  sampleRescan,
} from "@/test/msw/project/lottery/rescan-handlers";
import { sampleStoreBoard } from "@/test/msw/project/lottery/store-fixtures";

import { fastUser } from "../../../schedule/manage/roster/roster-test-queries";
import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";
const RESCAN_PATH = `/store/create-page/stocktake_confirm?org=${STORE_A}&rescan=rescan-1`;
const WHOLE_STORE_PATH = `/store/create-page/stocktake_confirm?org=${STORE_A}`;

const countBoard = () => ({
  board: sampleStoreBoard(STORE_A, "中山店", "count"),
});

/** 店外攤位刷到一半(王小明);其他還沒刷。 */
const outdoorScanning = () =>
  sampleRescan({
    places: sampleRescan().places.map((place) =>
      place.cashPointId === "cp-outdoor"
        ? { ...place, state: "scanning", scanningByName: "王小明", mine: true }
        : place,
    ),
  });

/** 刷到的碼 → 結果(Figma CS-10b 的清單)。 */
const CODES = {
  "0056528043": rescanItem("043", "matched", { partnerTicketNo: "050" }),
  "0056528038": rescanItem("038", "recovered"),
  "0056528040": rescanItem("040", "sold_here"),
  "0056528012": rescanItem("012", "skipped"),
  "0056528044": rescanItem("044", "ok"),
  "0056528045": rescanItem("045", "ok"),
  "0056528046": rescanItem("046", "ok"),
};

/**
 * 全店重刷(張數店規格 8.3–8.5a、13.1、13.2;Figma CS-01c、CS-09b、CS-10a–d、ST-16-2;驗收 16.7 S3–S5、S7、
 * S9 / S10 的重刷部分):看板的重刷提醒與 [全店重刷 遊戲 X]、開始的確認視窗、重刷中橫幅與「這裡還沒刷」、重刷頁
 * (選位置、刷到的結果、這裡刷完了、結果摘要、取消)、盤點頁正在重刷的組變灰、進入盤點時的提醒。
 */
describe("店面管理:全店重刷", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    writeLocalCashPoint(STORE_A, "cp-outdoor");
  });

  it("S3 看板的重刷提醒 → [全店重刷 遊戲 5164] → 開始前的確認(要刷的位置、先盤點、暫停移櫃、1 小時自動取消)→ 重刷頁", async () => {
    const user = fastUser();
    const { stocktake } = renderStore({
      world: countBoard(),
      stocktakeOptions: { rescanReminders: [rescanReminder()] },
    });
    expect(
      await screen.findByText(
        "遊戲 5164 發大財 有 1 張待查還沒確認是哪張,請把全店(各收銀台和庫存)的遊戲 5164 都刷一次。",
      ),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "全店重刷 遊戲 5164" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "開始全店重刷 5164 發大財?",
    });
    expect(
      within(dialog).getByText(
        "開始前請各收銀點先完成正在進行的交班或盤點,並先盤點遊戲 5164。",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("店內櫃台、店外攤位、彩券機旁、庫存(4 個)"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "重刷中暫停 5164 的移櫃,其他操作照常;全部位置刷完才結束,1 小時沒有任何位置刷到會自動取消。",
      ),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "開始全店重刷" }),
    );
    expect(stocktake.rescan.inputs.start).toEqual([
      { orgId: STORE_A, gameId: "g-5164" },
    ]);
    expect(
      await screen.findByRole("heading", { name: "全店重刷 · 5164 發大財" }),
    ).toBeInTheDocument();
  });

  it("只有標記異常的遊戲:提醒寫「盤點多出 N 張(標記異常)」", async () => {
    renderStore({
      world: countBoard(),
      stocktakeOptions: {
        rescanReminders: [
          rescanReminder({ investigateCount: 0, flaggedCount: 2 }),
        ],
      },
    });
    expect(
      await screen.findByText(
        "遊戲 5164 發大財 盤點多出 2 張(標記異常),請把全店(各收銀台和庫存)的遊戲 5164 都刷一次。",
      ),
    ).toBeInTheDocument();
  });

  it("CS-01c 重刷中:頂部「全店重刷中,暫停移櫃 · 已刷 1/3 個位置(還沒刷:…)· 剩 N 分鐘自動取消」[前往重刷];還沒刷的收銀點標「這裡還沒刷遊戲 5164」", async () => {
    const user = fastUser();
    const counterDone = sampleRescan({
      doneCount: 1,
      places: sampleRescan().places.map((place) =>
        place.cashPointId === "cp-counter"
          ? { ...place, state: "done" }
          : place,
      ),
    });
    renderStore({
      world: countBoard(),
      stocktakeOptions: { rescan: { rescan: counterDone } },
    });
    expect(
      await screen.findByText(
        "遊戲 5164 發大財 全店重刷中,暫停移櫃 · 已刷 1/3 個位置(還沒刷:店外攤位、庫存)· 剩 52 分鐘自動取消",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("這裡還沒刷遊戲 5164")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "前往重刷" }));
    expect(
      await screen.findByRole("heading", { name: "全店重刷 · 5164 發大財" }),
    ).toBeInTheDocument();
  });

  it("CS-10b 重刷頁:預設刷本機收銀點;刷到的結果即時列出(已對號、已尋回留在刷到的位置、記已售但還在 [送撤銷售出申請]、要先更正、連續沒問題合成一列)", async () => {
    const user = fastUser();
    const { stocktake } = renderStore({
      path: RESCAN_PATH,
      stocktakeOptions: { rescan: { rescan: sampleRescan(), codes: CODES } },
    });
    expect(
      await screen.findByText(
        "已刷 0/3 個位置 · 王小明 10:20 開始 · 剩 52 分鐘自動取消。重刷中暫停 5164 的移櫃,其他照常。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("現在刷:店外攤位")).toBeInTheDocument();
    const input = screen.getByRole("textbox", {
      name: "刷條碼、相機或手輸張號",
    });
    for (const code of Object.keys(CODES)) {
      await user.type(input, `${code}{Enter}`);
    }
    expect(stocktake.rescan.inputs.scan.at(0)).toEqual({
      orgId: STORE_A,
      rescanId: "rescan-1",
      cashPointId: "cp-outdoor",
      code: "0056528043",
    });
    expect(await screen.findByText("這裡已刷 7 張")).toBeInTheDocument();
    expect(screen.getByText("已對號")).toBeInTheDocument();
    expect(screen.getByText("已尋回(留在店外攤位)")).toBeInTheDocument();
    expect(screen.getByText("記已售但還在")).toBeInTheDocument();
    expect(screen.getByText("記跳號,要先更正")).toBeInTheDocument();
    expect(
      screen.getByText("5164 · 056528 · #044~046 等 3 張"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "送撤銷售出申請" }),
    ).toBeInTheDocument();
    expect(screen.getByText("刷到一半 · 王小明")).toBeInTheDocument();
  });

  it("CS-10c / 10d [這裡刷完了] 先確認;全部位置刷完 → 結果摘要", async () => {
    const user = fastUser();
    const { stocktake } = renderStore({
      path: RESCAN_PATH,
      stocktakeOptions: { rescan: { rescan: sampleRescan(), codes: CODES } },
    });
    const input = await screen.findByRole("textbox", {
      name: "刷條碼、相機或手輸張號",
    });
    await user.type(input, "0056528043{Enter}");
    await user.type(input, "0056528040{Enter}");
    await screen.findByText("這裡已刷 2 張");
    await user.click(screen.getByRole("button", { name: "這裡刷完了" }));
    const dialog = await screen.findByRole("dialog", {
      name: "店外攤位刷到 2 張,確定刷完了?",
    });
    expect(
      within(dialog).getByText(
        "按下後,系統記在店外攤位、這次沒刷到的 5164 未售會記成待查(之後別的位置刷到會自動更正)。",
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "刷完了" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(stocktake.rescan.inputs.finish).toEqual([
      { orgId: STORE_A, rescanId: "rescan-1", cashPointId: "cp-outdoor" },
    ]);
    // 下一個還沒刷的位置(店內櫃台),刷完;再刷庫存
    expect(await screen.findByText("現在刷:店內櫃台")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "這裡刷完了" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "刷完了",
      }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(await screen.findByText("現在刷:庫存")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "這裡刷完了" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "刷完了",
      }),
    );
    expect(
      await screen.findByText(
        "全店重刷完成 · 3/3 個位置 · 10:58 結束;5164 的移櫃已恢復。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("結果摘要")).toBeInTheDocument();
    expect(
      screen.getByText("1 張(成本差額列對號成本調整)"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 張(#040,請送撤銷售出申請)")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getAllByRole("button", { name: "回到看板" })).toHaveLength(2);
  });

  it("S9 這個位置有人盤點中 → 輸入框下方說誰、幾點開始、剩幾分鐘", async () => {
    const user = fastUser();
    renderStore({
      path: RESCAN_PATH,
      stocktakeOptions: {
        rescan: {
          rescan: sampleRescan(),
          codes: CODES,
          scanError: {
            reason: RESCAN_REASONS.placeStocktaking,
            extensions: {
              byName: "李小華",
              startedAt: "2026-10-13T02:05:00.000Z",
              minutesLeft: 52,
            },
          },
        },
      },
    });
    const input = await screen.findByRole("textbox", {
      name: "刷條碼、相機或手輸張號",
    });
    await user.type(input, "0056528043{Enter}");
    expect(
      await screen.findByText(
        "這個位置正在由 李小華 盤點(10:05 開始,剩 52 分鐘自動結束),請等他送出。",
      ),
    ).toBeInTheDocument();
  });

  it("[取消重刷](開始的人或店長)→ 確認 → 取消,已刷完的位置更正保留;不能取消的人沒有這顆鈕", async () => {
    const user = fastUser();
    const { stocktake } = renderStore({
      path: RESCAN_PATH,
      stocktakeOptions: { rescan: { rescan: outdoorScanning() } },
    });
    await user.click(await screen.findByRole("button", { name: "取消重刷" }));
    const dialog = await screen.findByRole("dialog", { name: "取消重刷?" });
    await user.click(within(dialog).getByRole("button", { name: "取消重刷" }));
    expect(stocktake.rescan.inputs.cancel).toEqual([
      { orgId: STORE_A, rescanId: "rescan-1" },
    ]);
    expect(
      await screen.findByText(
        "這次全店重刷已取消:已刷完的位置的更正保留,其餘位置不處理,5164 的移櫃已恢復。",
      ),
    ).toBeInTheDocument();
  });

  it("不是開始的人、也不是店長:沒有 [取消重刷]", async () => {
    renderStore({
      path: RESCAN_PATH,
      stocktakeOptions: {
        rescan: { rescan: sampleRescan({ canCancel: false }) },
      },
    });
    await screen.findByText("現在刷:店外攤位");
    expect(screen.queryByRole("button", { name: "取消重刷" })).toBeNull();
  });

  it("S10 B5 盤點頁:正在重刷的位置那一組變灰、不能輸入,頂部寫「這裡正在重刷 5164,刷完再數」;待查清單上方有重刷提醒", async () => {
    const user = fastUser();
    const counterScanning = sampleRescan({
      places: sampleRescan().places.map((place) =>
        place.cashPointId === "cp-counter"
          ? { ...place, state: "scanning", scanningByName: "李小華" }
          : place,
      ),
    });
    renderStore({
      path: WHOLE_STORE_PATH,
      stocktakeOptions: {
        countMode: true,
        rescan: { rescan: counterScanning },
        rescanReminders: [
          rescanReminder({
            gameId: "g-5201",
            gameCode: "5201",
            gameName: "金好運",
          }),
        ],
      },
    });
    expect(
      await screen.findByText(
        "店內櫃台 · 5164 發大財:這裡正在重刷 5164,刷完再數。",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText("重刷中")).toBeInTheDocument();
    // 第一組(店內櫃台 · 5164)正在重刷:輸入框停用、寫原因
    expect(
      await screen.findByText("這裡正在重刷 5164,刷完再數。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "實際剩幾張" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "全店重刷 遊戲 5201" }),
    ).toBeInTheDocument();
    await user.click(screen.getByText("5201 金好運"));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "實際剩幾張" })).toBeEnabled();
    });
  });

  it("ST-16-2 進入盤點時有重刷進行中 → 先提醒還沒刷完的位置(只提醒、不擋);[繼續盤點] 才登記", async () => {
    const user = fastUser();
    const { stocktake } = renderStore({
      world: countBoard(),
      stocktakeOptions: { rescan: { rescan: outdoorScanning() } },
    });
    await user.click(await screen.findByRole("button", { name: "盤點" }));
    const scope = await screen.findByRole("dialog", {
      name: "開始盤點(臨時)",
    });
    await user.click(within(scope).getByRole("button", { name: "開始盤點" }));
    const notice = await screen.findByRole("dialog", {
      name: "遊戲 5164 發大財 正在全店重刷",
    });
    expect(
      within(notice).getByText(
        "還沒刷完的位置:店內櫃台、店外攤位、庫存;這些位置的 5164 要等刷完才能數,其他照常盤。",
      ),
    ).toBeInTheDocument();
    expect(stocktake.inputs.sessionStarts).toEqual([]);
    await user.click(within(notice).getByRole("button", { name: "繼續盤點" }));
    await waitFor(() => {
      expect(stocktake.inputs.sessionStarts).toHaveLength(1);
    });
  });
});
