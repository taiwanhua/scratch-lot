import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { act, screen, waitFor, within } from "@testing-library/react";

import { STORE_PERMISSIONS as P } from "@repo/domain/project/lottery";

import { injectScan } from "@/hooks/project/useScanner/scanner-registry";
import { writeLocalCashPoint } from "@/lib/project/lottery/local-cash-point";
import { findLatestSnackbar } from "@/test/snackbar";

import { setCameraReaderFactory } from "../BoardTab/sales/camera-reader";
import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";

/** 不做事的回呼(假的媒體查詢監聽、相機停止)。 */
const ignore = (): void => {
  // 測試裡不需要
};

/** 收銀點那一區(標題列 + 卡片)。 */
const sectionOf = async (name: string): Promise<HTMLElement> => {
  const heading = await screen.findByRole("heading", { name });
  const section = heading.closest<HTMLElement>(".MuiCard-root")?.parentElement;
  if (section == null) {
    throw new Error(`找不到收銀點:${name}`);
  }
  return section;
};

/** 打開某一區的卡片(以卡片標題找),回展開的區塊。 */
const expandCard = async (
  user: ReturnType<typeof renderStore>["user"],
  cashPoint: string,
  title: string,
  panelName: string,
): Promise<HTMLElement> => {
  const section = await sectionOf(cashPoint);
  const card = within(section).getByText(title).closest<HTMLElement>("button");
  if (card === null) {
    throw new Error(`找不到卡片:${title}`);
  }
  await user.click(card);
  return within(section).findByLabelText(panelName);
};

/** 等看板載好再刷(看板頁宣告掃描用途後才會交給銷售)。 */
const scan = async (code: string) => {
  await sectionOf("店內櫃台");
  act(() => {
    injectScan(code);
  });
};

/**
 * 店面管理 → 銷售(規格 6.2–6.4;Figma ST-05–10、ST-35–37):刷條碼 / 相機 / 快速銷售、售出提示與當下撤銷、
 * 選遊戲、同時售出的失敗方、展開卡片的操作列、手動標記、拆本精靈;沒有權限看不到按鈕(L350)。
 */
describe("店面管理:銷售", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    writeLocalCashPoint(STORE_A, "cp-counter");
  });

  it("刷條碼:本機收銀點檯面直接售出 → 提示 [撤銷] → 撤銷確認 → 撤銷", async () => {
    const { user, salesFake } = renderStore();
    await scan("0056527099");
    const toast = await findLatestSnackbar();
    expect(toast).toHaveTextContent("已售出");
    expect(toast).toHaveTextContent("5164-056527-099 200 元 · 店內櫃台");
    expect(salesFake.inputs.sell).toEqual([
      expect.objectContaining({
        localCashPointId: "cp-counter",
        source: "scan",
        tickets: [{ ticketId: "b-1-t99", version: 3 }],
      }),
    ]);
    await user.click(within(toast).getByRole("button", { name: "撤銷" }));
    const dialog = await screen.findByRole("dialog", {
      name: "撤銷這張售出?",
    });
    expect(
      within(dialog).getByText(/撤銷後 200 元從店內櫃台的抽屜應有金額扣除/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "撤銷" }));
    await waitFor(() => {
      expect(salesFake.inputs.undo).toEqual([
        { ticketId: "b-1-t99", version: 4 },
      ]);
    });
  });

  it("相機掃描:注入模擬的讀碼結果 0056527099 → 走跟條碼槍相同的銷售流程", async () => {
    const originalMatch = globalThis.matchMedia;
    const originalDevices = globalThis.navigator.mediaDevices;
    // 觸控為主的指標(手機 / 平板);jsdom 沒有 matchMedia,其他查詢一律不符合
    globalThis.matchMedia = ((query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: ignore,
      removeListener: ignore,
      addEventListener: ignore,
      removeEventListener: ignore,
      dispatchEvent: () => false,
    })) satisfies typeof globalThis.matchMedia;
    Object.defineProperty(globalThis.navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: () => Promise.resolve([{ kind: "videoinput" }]),
      },
    });
    const reader: { emit: ((code: string) => void) | null } = { emit: null };
    const restore = setCameraReaderFactory((_video, onCode) => {
      reader.emit = onCode;
      return Promise.resolve({ stop: ignore });
    });
    try {
      const { user, salesFake } = renderStore();
      await user.click(await screen.findByRole("button", { name: "📷 掃描" }));
      await screen.findByRole("dialog", { name: "相機掃描" });
      act(() => {
        reader.emit?.("0056527099");
      });
      await waitFor(() => {
        expect(salesFake.inputs.sell).toEqual([
          expect.objectContaining({
            source: "scan",
            tickets: [{ ticketId: "b-1-t99", version: 3 }],
          }),
        ]);
      });
      expect(await findLatestSnackbar()).toHaveTextContent("5164-056527-099");
    } finally {
      restore();
      globalThis.matchMedia = originalMatch;
      Object.defineProperty(globalThis.navigator, "mediaDevices", {
        configurable: true,
        value: originalDevices,
      });
    }
  });

  describe("快速銷售(沒有頁面宣告用途時)", () => {
    it("刷到刮刮樂 → 小視窗;Enter 確認售出", async () => {
      const { user, salesFake } = renderStore({
        path: "/store?tab=other-forms",
      });
      await screen.findByRole("tab", { name: "其他申請" });
      act(() => {
        injectScan("0056527099");
      });
      const dialog = await screen.findByRole("dialog", { name: "快速銷售" });
      expect(within(dialog).getByText("200")).toBeInTheDocument();
      await user.keyboard("{Enter}");
      await waitFor(() => {
        expect(salesFake.inputs.sell).toHaveLength(1);
      });
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "快速銷售" })).toBeNull();
      });
    });

    it("Esc 取消:不售出", async () => {
      const { user, salesFake } = renderStore({
        path: "/store?tab=other-forms",
      });
      await screen.findByRole("tab", { name: "其他申請" });
      act(() => {
        injectScan("0056527098");
      });
      await screen.findByRole("dialog", { name: "快速銷售" });
      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: "快速銷售" })).toBeNull();
      });
      expect(salesFake.inputs.sell).toEqual([]);
    });
  });

  it("本號在本店對到兩款遊戲 → 選遊戲;同時售出的失敗方看到「已於 hh:mm 售出」", async () => {
    const { user, salesFake } = renderStore({
      sales: { alreadySoldAt: "2026-10-16T05:05:00.000Z" },
    });
    await scan("0060112050");
    const pick = await screen.findByRole("dialog", { name: "選遊戲" });
    await user.click(within(pick).getByRole("radio", { name: /5170 大吉利/ }));
    await user.click(within(pick).getByRole("button", { name: "繼續" }));
    const blocked = await screen.findByRole("dialog", { name: "不能銷售" });
    expect(
      within(blocked).getByText("這張刮刮樂已於 13:05 售出"),
    ).toBeInTheDocument();
    expect(salesFake.inputs.sell).toEqual([
      expect.objectContaining({
        tickets: [{ ticketId: "b-same-no-t50", version: 1 }],
      }),
    ]);
  });

  it("刷到別的收銀點(別人 / 自己的班)→ 確認視窗;移櫃並售出帶 confirmMove", async () => {
    const { user, salesFake } = renderStore();
    // 店外攤位也是王小明開的(夾具 isMine)→ 直接算那一班
    await scan("0056528099");
    const mine = await screen.findByRole("dialog", {
      name: "刷到店外攤位的刮刮樂 · 你開的班",
    });
    await user.click(within(mine).getByRole("button", { name: "確認售出" }));
    await waitFor(() => {
      expect(salesFake.inputs.sell).toEqual([
        expect.objectContaining({ confirmMove: false }),
      ]);
    });
  });

  it("拆本:待標註 2 張沒點滿 → [下一步] 停用;分放沒分完 → [確認拆本] 停用", async () => {
    const { user, salesFake } = renderStore();
    const counter = await sectionOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "拆本" }));
    const pick = await screen.findByRole("dialog", {
      name: "拆本 · 選要拆的本",
    });
    await user.click(
      await within(pick).findByRole("radio", {
        name: /5201 金好運 · 本號 060116/,
      }),
    );
    await user.click(within(pick).getByRole("button", { name: "下一步" }));
    const wizard = await screen.findByRole("dialog", {
      name: "拆本 · 5201 金好運 · 本號 060116",
    });
    const next = within(wizard).getByRole("button", { name: "下一步" });
    expect(next).toBeDisabled();
    await user.click(within(wizard).getByRole("button", { name: "#037 未售" }));
    expect(next).toBeDisabled();
    await user.click(within(wizard).getByRole("button", { name: "#064 未售" }));
    expect(next).toBeEnabled();
    await user.click(next);
    await user.click(
      within(wizard).getByRole("radio", { name: "分放到多個收銀點" }),
    );
    const confirm = within(wizard).getByRole("button", { name: "確認拆本" });
    expect(confirm).toBeDisabled();
    await user.click(
      within(wizard).getByRole("button", { name: "#001 未分配" }),
    );
    await user.click(within(wizard).getByRole("button", { name: "店外攤位" }));
    expect(
      within(wizard).getByText("還有 99 張沒分配,全部分配完才能確認拆本。"),
    ).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    await user.click(
      within(wizard).getByRole("radio", { name: "全部放到同一個收銀點" }),
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => {
      expect(salesFake.inputs.split).toEqual([
        expect.objectContaining({
          bookId: "b-new-1",
          skippedTicketNos: ["037", "064"],
          assignments: [expect.objectContaining({ cashPointId: "cp-counter" })],
        }),
      ]);
    });
    const split = salesFake.inputs.split.at(0);
    expect(split?.assignments.at(0)?.ticketNos).toHaveLength(100);
  });

  it("展開卡片:本機收銀點選未售 → [標記售出] [移櫃] [收回];標記售出原因預設「刷不到條碼」", async () => {
    const { user, salesFake } = renderStore();
    const panel = await expandCard(
      user,
      "店內櫃台",
      "5164 發大財",
      "5164 發大財 · 本號 056527",
    );
    await user.click(
      await within(panel).findByRole("button", { name: "#080 未售" }),
    );
    expect(within(panel).getByText(/已選 1 張 #080/)).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "移櫃" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "收回" }),
    ).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "標記售出" }));
    const dialog = await screen.findByRole("dialog", { name: "標記售出" });
    expect(
      await within(dialog).findByRole("combobox", { name: /原因/ }),
    ).toHaveTextContent("刷不到條碼");
    await user.click(within(dialog).getByRole("button", { name: "確認售出" }));
    await waitFor(() => {
      expect(salesFake.inputs.sell).toEqual([
        expect.objectContaining({
          source: "manual",
          reasonKey: "scan-failed",
          tickets: [{ ticketId: "b-1-t80", version: 3 }],
        }),
      ]);
    });
  });

  it("展開卡片:其他收銀點選未售 → [移櫃] [移櫃並售出](沒有 [標記售出])", async () => {
    const { user } = renderStore();
    const panel = await expandCard(
      user,
      "店外攤位",
      "5133 招財貓",
      "5133 招財貓 · 本號 071204",
    );
    await user.click(
      await within(panel).findByRole("button", { name: "#020 未售" }),
    );
    expect(
      within(panel).getByRole("button", { name: "移櫃並售出" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "移櫃" }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByRole("button", { name: "標記售出" }),
    ).toBeNull();
  });

  it("沒有權限看不到按鈕:拆本、移櫃 / 收回 / 移櫃並售出、標記售出、撤銷售出", async () => {
    const { user } = renderStore({ permissions: [P.view] });
    const counter = await sectionOf("店內櫃台");
    expect(within(counter).queryByRole("button", { name: "拆本" })).toBeNull();
    const panel = await expandCard(
      user,
      "店內櫃台",
      "5164 發大財",
      "5164 發大財 · 本號 056527",
    );
    await user.click(
      await within(panel).findByRole("button", { name: "#080 未售" }),
    );
    for (const name of ["標記售出", "移櫃", "收回"]) {
      expect(within(panel).queryByRole("button", { name })).toBeNull();
    }
    await user.click(within(panel).getByRole("button", { name: "取消選取" }));
    await user.click(
      within(panel).getByRole("button", { name: "#060 本班售出" }),
    );
    expect(
      within(panel).queryByRole("button", { name: "撤銷售出" }),
    ).toBeNull();
  });

  it("[最近售出]:自己這一班賣的張,撤銷後那一筆顯示「已撤銷」", async () => {
    const { user } = renderStore();
    await scan("0056527098");
    await findLatestSnackbar();
    const counter = await sectionOf("店內櫃台");
    await user.click(within(counter).getByRole("button", { name: "最近售出" }));
    const drawer = await screen.findByRole("presentation");
    await user.click(
      await within(drawer).findByRole("button", { name: "撤銷" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "撤銷這張售出?",
    });
    await user.click(within(dialog).getByRole("button", { name: "撤銷" }));
    expect(await within(drawer).findByText("已撤銷")).toBeInTheDocument();
  });
});

afterEach(() => {
  globalThis.localStorage.clear();
});
