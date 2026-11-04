import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { parseStocktakeDraft } from "@repo/domain/project/lottery";

import { sampleStoreBoard } from "@/test/msw/project/lottery/store-fixtures";

import { fastUser } from "../../../schedule/manage/roster/roster-test-queries";
import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";
const RENUMBER_PATH = `/store/create-page/stocktake_confirm?org=${STORE_A}&purpose=renumber`;

const cell = (label: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(
    `[aria-label="${CSS.escape(label)}"]`,
  );
  if (found === null) {
    throw new Error(`沒有格子 ${label}`);
  }
  return found;
};

/** 看板:這家店的盤點制度與補點編號提醒。 */
const boardOf = (
  countMode: "count" | "converting",
  renumber: { due: boolean; lastRenumberAt: string | null } | null = null,
) => ({
  ...sampleStoreBoard(STORE_A, "中山店", countMode),
  renumber:
    renumber === null
      ? null
      : { __typename: "LotteryStoreRenumber" as const, ...renumber },
});

/**
 * 補點編號(張數店規格 9.2、9.3、10、13.2;Figma CS-01b、CS-11、CS-13a~c):看板的轉換中提示與 [補點編號]、
 * 補點編號提醒;補點編號的盤點頁(全店、照編號盤點逐本、虛線格子可點、全部盤完才能差異核對、自動對號不算差異、
 * 待標註的本 [標跳號]);日結第 ② 步「這次做補點編號」與第 ⑤ 步「補點編號 · 對號 N 張」。
 */
describe("店面管理:補點編號", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("CS-01b 轉換中:看板一直提示「轉換中:請完成補點編號」,[補點編號] 先登記全店的盤點中(補點)再進補點編號的盤點頁", async () => {
    const user = fastUser();
    const { stocktake } = renderStore({
      world: { board: boardOf("converting") },
      stocktakeOptions: { renumber: true },
    });
    const notice = await screen.findByText(
      "轉換中:請完成補點編號。完成前銷售、收回、移櫃都要刷條碼或手輸張號。",
    );
    const alert = notice.closest<HTMLElement>('[role="alert"]');
    if (alert === null) {
      throw new Error("沒有轉換中的提示");
    }
    await user.click(within(alert).getByRole("button", { name: "補點編號" }));
    expect(
      await screen.findByRole("heading", { name: "補點編號 · 全店" }),
    ).toBeInTheDocument();
    expect(stocktake.inputs.sessionStarts.at(0)).toMatchObject({
      type: "adhoc",
      purpose: "renumber",
    });
  });

  it("RN4 張數店補點編號提醒週期到了:看板「建議補點編號(上次 10/7)」", async () => {
    renderStore({
      world: {
        board: boardOf("count", {
          due: true,
          lastRenumberAt: "2026-10-07T07:00:00.000Z",
        }),
      },
    });
    // 日期照後台的「月/日」寫法(同上次日結)
    expect(
      await screen.findByText("建議補點編號(上次 10/7)"),
    ).toBeInTheDocument();
  });

  it("CS-11 補點編號的盤點頁:虛線格子可以點、全部盤完才能前往差異核對;自動對號不算差異,待標註的本可以 [標跳號]", async () => {
    const user = fastUser();
    const { stocktake } = renderStore({
      path: RENUMBER_PATH,
      stocktakeOptions: { renumber: true },
    });
    expect(
      await screen.findByRole("heading", { name: "補點編號 · 全店" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/補點編號中:全部遊戲暫停移櫃。每本都要盤/u),
    ).toBeInTheDocument();
    expect(screen.getByText("虛線 = 系統預設帶入的張號")).toBeInTheDocument();
    // 一本 + 一本未拆的本都還沒盤:不能前往差異核對
    expect(
      screen.getByText(
        "還有 2 本沒盤,全部盤完才能前往差異核對。盤的時候可以繼續賣。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "差異核對 →" })).toBeDisabled();

    // #015 是已售·未對號(虛線):實際在;#016–023 在;#024 #025 不在
    await user.click(await screen.findByText("5133 招財貓", { selector: "p" }));
    await user.click(cell("#015 已售·未對號"));
    for (const no of ["016", "017", "018", "019", "020", "021", "022", "023"]) {
      await user.click(cell(`#${no} 未售`));
    }
    // 未拆的本:在
    await user.click(screen.getByRole("radio", { name: "在" }));
    await waitFor(() => {
      expect(
        screen.getByText("全部盤完了,可以前往差異核對。盤的時候可以繼續賣。"),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "差異核對 →" }));
    expect(
      await screen.findByText("自動對號 1 張(不算差異)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "店外攤位 · 5133 招財貓:#015(本號 071204)↔ #024(本號 071204)",
      ),
    ).toBeInTheDocument();
    // 剩下 #025 不在:照編號差異,這本還有 1 張待標註 → [標跳號]
    expect(
      screen.getByText("這本還有 1 張待標註:不在的張可以 [標跳號]。"),
    ).toBeInTheDocument();
    const row = screen.getByText("#025", { selector: "td" }).closest("tr");
    if (row === null) {
      throw new Error("沒有 #025 那一列");
    }
    await user.click(within(row).getByRole("button", { name: "標跳號" }));
    expect(
      await within(row).findByText("核准時標跳號(這本的待標註)"),
    ).toBeInTheDocument();
    const draft = stocktake.inputs.reviews.at(-1);
    expect(draft).toMatchObject({ countMode: "numbered", purpose: "renumber" });
    expect(draft?.lines[0]?.diffs).toEqual([
      expect.objectContaining({ ticketNo: "025", action: "skip" }),
    ]);
    expect(parseStocktakeDraft(JSON.stringify(draft)).ok).toBe(true);
  });

  it("CS-13a 日結第 ② 步:轉換中預設「這次做補點編號」;設必須的店月底最後一天提示關帳會被擋;補點的登記帶 purpose", async () => {
    const user = fastUser();
    const { stocktake } = renderStore({
      path: `/store/create-page/checkout_confirm?org=${STORE_A}&type=daily`,
      dailyCloseOptions: {
        allApproved: true,
        renumber: { suggested: true, monthEndWarning: true },
      },
      stocktakeOptions: { renumber: true },
    });
    await screen.findByRole("heading", { name: "日結 · 中山店" });
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByText("② 全店盤點")).toBeInTheDocument();
    expect(
      screen.getByText(
        "本月還沒補點編號,關帳會被擋。這次日結請選「這次做補點編號」。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "這次做補點編號" })).toBeChecked();
    // 張數店不能跳過盤點
    expect(screen.queryByRole("radio", { name: "跳過盤點" })).toBeNull();
    expect(
      await screen.findByText("虛線 = 系統預設帶入的張號"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(stocktake.inputs.sessionStarts.at(-1)).toMatchObject({
        type: "daily",
        purpose: "renumber",
      });
    });
    // 改選「現在盤點」:一般的全店盤點(重新登記,不帶 purpose)
    await user.click(screen.getByRole("radio", { name: "現在盤點" }));
    await waitFor(() => {
      expect(stocktake.inputs.sessionStarts.at(-1)?.purpose).toBeUndefined();
    });
  });
});
