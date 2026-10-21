import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { STORE_PERMISSIONS as P } from "@repo/domain/project/lottery";

import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";

import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";

/** 收銀點標題列(以名稱找那一列;同一頁有三列)。 */
const headerOf = async (name: string): Promise<HTMLElement> => {
  const heading = await screen.findByRole("heading", { name });
  const card = heading.closest<HTMLElement>(".MuiCard-root");
  if (card === null) {
    throw new Error(`找不到收銀點標題列:${name}`);
  }
  return card;
};

/**
 * 店面管理 → 看板(規格 6.1、6.2、6.6、6.7;Figma ST-01 / 03 / 04 / 12 / 34 / 42):
 * 收銀點標題列與卡片、本機收銀點、開班、投庫 / 出庫、班次資訊與改對應排班;沒有權限看不到按鈕(L350)。
 */
describe("店面管理:看板", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("分頁、標題列(本班已售、應有現金)、卡片(剩很少);沒設本機收銀點 → 提示 → 設定", async () => {
    const { user } = renderStore();
    expect(
      await screen.findByRole("tab", { name: "看板" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "其他申請" })).toBeInTheDocument();
    const counter = await headerOf("店內櫃台");
    expect(within(counter).getByText("42 張 / 8,400")).toBeInTheDocument();
    expect(within(counter).getByText("12,350")).toBeInTheDocument();
    expect(screen.getByText("5198 鼠來寶")).toBeInTheDocument();
    expect(screen.getByText("剩 6 / 100")).toBeInTheDocument();
    expect(screen.getAllByText("剩很少")).toHaveLength(1);
    expect(
      screen.getByText("你開著的班:店內櫃台 · 店外攤位"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "設定本機收銀點" }));
    const dialog = await screen.findByRole("dialog", {
      name: "設定本機收銀點",
    });
    await user.click(within(dialog).getByRole("radio", { name: "店內櫃台" }));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(within(counter).getByText("本機")).toBeInTheDocument();
    expect(
      globalThis.localStorage.getItem(
        `lottery-store.local-cash-point.${STORE_A}`,
      ),
    ).toBe("cp-counter");
  });

  it("按鈕依狀態:本機開班中 [投庫] [出庫];自己開的別的班 [切換到這個收銀點];未開班 [開班]", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    renderStore();
    const counter = await headerOf("店內櫃台");
    expect(
      within(counter).getByRole("button", { name: "投庫" }),
    ).toBeInTheDocument();
    expect(
      within(counter).getByRole("button", { name: "出庫" }),
    ).toBeInTheDocument();
    const outdoor = await headerOf("店外攤位");
    expect(
      within(outdoor).getByRole("button", { name: "切換到這個收銀點" }),
    ).toBeInTheDocument();
    expect(within(outdoor).queryByRole("button", { name: "投庫" })).toBeNull();
    const machine = await headerOf("彩券機旁");
    expect(
      within(machine).getByRole("button", { name: "開班" }),
    ).toBeInTheDocument();
  });

  it("沒有 open-shift / deposit / withdraw → 看不到 [開班] [投庫] [出庫]", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    renderStore({ permissions: [P.view] });
    const counter = await headerOf("店內櫃台");
    expect(within(counter).queryByRole("button", { name: "投庫" })).toBeNull();
    expect(within(counter).queryByRole("button", { name: "出庫" })).toBeNull();
    const machine = await headerOf("彩券機旁");
    expect(within(machine).queryByRole("button", { name: "開班" })).toBeNull();
  });

  it("切換本機收銀點:目前的是自己開著的班 → 先確認", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    const { user } = renderStore();
    const outdoor = await headerOf("店外攤位");
    await user.click(
      within(outdoor).getByRole("button", { name: "切換到這個收銀點" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "切換本機收銀點?",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "切換到店外攤位" }),
    );
    await waitFor(() => {
      expect(within(outdoor).getByText("本機")).toBeInTheDocument();
    });
    expect(
      within(outdoor).getByRole("button", { name: "投庫" }),
    ).toBeInTheDocument();
  });

  it("開班:預選系統找到的排班;崗位不一致 → 提醒並改成 [仍要開班];領零用金一起送出", async () => {
    const { user, fake } = renderStore();
    const machine = await headerOf("彩券機旁");
    await user.click(within(machine).getByRole("button", { name: "開班" }));
    const dialog = await screen.findByRole("dialog", {
      name: "開班 · 彩券機旁",
    });
    expect(
      await within(dialog).findByRole("combobox", { name: /對應排班/ }),
    ).toHaveTextContent(
      "早 08:00–16:00 · 店內櫃台 · 負責 · 店內事務與帳目負責",
    );
    expect(
      within(dialog).getByText(/你今天排的是「店內櫃台」/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("你還沒打上班卡")).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole("textbox", { name: "從小金庫領零用金" }),
      "3000",
    );
    expect(within(dialog).getByText("3,000")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "仍要開班" }));
    await waitFor(() => {
      expect(fake.inputs.open).toEqual([
        {
          cashPointId: "cp-machine",
          temporaryCover: false,
          scheduleEntryId: "entry-morning",
          floatFromVault: 3000,
        },
      ]);
    });
  });

  it("開班:選「沒有排班(臨時代班)」→ 送出 temporaryCover", async () => {
    const { user, fake } = renderStore();
    const machine = await headerOf("彩券機旁");
    await user.click(within(machine).getByRole("button", { name: "開班" }));
    const dialog = await screen.findByRole("dialog", {
      name: "開班 · 彩券機旁",
    });
    await user.click(
      await within(dialog).findByRole("combobox", { name: /對應排班/ }),
    );
    await user.click(
      await screen.findByRole("option", { name: "沒有排班(臨時代班)" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "開班" }));
    await waitFor(() => {
      expect(fake.inputs.open).toEqual([
        expect.objectContaining({
          temporaryCover: true,
          scheduleEntryId: null,
        }),
      ]);
    });
  });

  it("投庫:超過抽屜應有 → 擋下的提示;改小再送出", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    const { user, fake } = renderStore();
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "投庫" }));
    const dialog = await screen.findByRole("dialog", {
      name: "投庫 · 抽屜 → 小金庫",
    });
    const amount = within(dialog).getByRole("textbox", { name: /金額/ });
    await user.type(amount, "20000");
    await user.click(within(dialog).getByRole("button", { name: "投庫" }));
    expect(
      await within(dialog).findByText("投庫金額不能超過抽屜目前的應有現金"),
    ).toBeInTheDocument();
    await user.clear(amount);
    await user.type(amount, "5000");
    await user.click(within(dialog).getByRole("button", { name: "投庫" }));
    await waitFor(() => {
      expect(within(counter).getByText("7,350")).toBeInTheDocument();
    });
    expect(fake.inputs.deposit.at(-1)).toEqual({
      shiftId: "shift-counter",
      amount: 5000,
      note: null,
    });
  });

  it("出庫:原因必填(欄位管理「出庫原因」);超過小金庫應有 → 擋下的提示", async () => {
    writeLocalCashPoint(STORE_A, "cp-counter");
    const { user, fake } = renderStore();
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "出庫" }));
    const dialog = await screen.findByRole("dialog", {
      name: "出庫 · 小金庫 → 抽屜",
    });
    expect(within(dialog).getByText("48,200")).toBeInTheDocument();
    await user.type(
      within(dialog).getByRole("textbox", { name: /金額/ }),
      "500",
    );
    await user.click(within(dialog).getByRole("button", { name: "出庫" }));
    expect(fake.inputs.withdraw).toEqual([]);
    await user.click(within(dialog).getByRole("combobox", { name: /原因/ }));
    await user.click(await screen.findByRole("option", { name: "補零錢" }));
    // 超過小金庫應有(48,200)→ 擋下的提示
    const amount = within(dialog).getByRole("textbox", { name: /金額/ });
    await user.clear(amount);
    await user.type(amount, "50000");
    await user.click(within(dialog).getByRole("button", { name: "出庫" }));
    expect(
      await within(dialog).findByText(
        "小金庫應有不足,請先用現金更正單登記小金庫實際的錢",
      ),
    ).toBeInTheDocument();
    await user.clear(amount);
    await user.type(amount, "500");
    await user.click(within(dialog).getByRole("button", { name: "出庫" }));
    await waitFor(() => {
      expect(fake.inputs.withdraw.at(-1)).toEqual({
        shiftId: "shift-counter",
        amount: 500,
        reasonKey: "change-refill",
        reasonNote: null,
        note: null,
      });
    });
  });

  it("班次資訊 → [改對應排班]:選另一筆、原因必填後儲存", async () => {
    const { user, fake } = renderStore();
    const counter = await headerOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "班次資訊" }));
    const info = await screen.findByRole("dialog", {
      name: "班次資訊 · 店內櫃台",
    });
    expect(await within(info).findByText("3,000")).toBeInTheDocument();
    await user.click(within(info).getByRole("button", { name: "改對應排班" }));
    const dialog = await screen.findByRole("dialog", { name: "改對應排班" });
    await user.click(
      within(dialog).getByRole("radio", { name: "沒有排班(臨時代班)" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    expect(fake.inputs.reassign).toEqual([]);
    await user.click(within(dialog).getByRole("combobox", { name: /原因/ }));
    await user.click(await screen.findByRole("option", { name: "換班" }));
    await user.click(within(dialog).getByRole("button", { name: "儲存" }));
    await waitFor(() => {
      expect(fake.inputs.reassign).toEqual([
        {
          shiftId: "shift-counter",
          temporaryCover: true,
          scheduleEntryId: null,
          reasonKey: "shift-swap",
          reasonNote: null,
        },
      ]);
    });
  });
});

describe("店面管理頁殼的高度(STYLE-08)", () => {
  it("分頁殼的卡片不釘高:內容少時撐滿、多時跟著長(flex-grow 1、flex-shrink 0),交給 <main> 捲", async () => {
    renderStore();
    // 殼的頁籤列也是 tablist:取包在卡片裡的那一個(頁內分頁)
    const tablists = await screen.findAllByRole("tablist");
    const card = tablists
      .map((tabs) => tabs.closest<HTMLElement>(".MuiCard-root"))
      .find((found): found is HTMLElement => found !== null);
    if (card === undefined) {
      throw new Error("找不到分頁殼的卡片");
    }
    const style = globalThis.getComputedStyle(card);
    expect(style.flexGrow).toBe("1");
    expect(style.flexShrink).toBe("0");
  });
});
