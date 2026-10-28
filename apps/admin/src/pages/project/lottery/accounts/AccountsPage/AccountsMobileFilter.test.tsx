import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import type {
  LotteryBankTransactionsQueryVariables,
  LotteryCashLedgerQueryVariables,
} from "@repo/graphql";

import { api, server } from "@/test/msw/server";
import {
  restoreViewportAfterEach,
  setMobileViewport,
  setViewportWidth,
} from "@/test/viewport";

import { renderAccounts } from "../accounts-test-support";

restoreViewportAfterEach();

/** 打開 [篩選] 的底部抽屜,回抽屜本身。 */
const openDrawer = async (
  user: ReturnType<typeof renderAccounts>["user"],
  name = "篩選",
) => {
  await user.click(await screen.findByRole("button", { name }));
  return screen.findByRole("presentation");
};

/**
 * 帳戶管理手機篩選(規格 16.0;Figma AC-02b 739:1876、AC-04b 739:2078):
 * 手機寬篩選欄位收進 [篩選] 底部抽屜,改的是草稿,按 [套用] 才查;電腦 / 平板維持攤開的篩選列。
 */
describe("帳戶管理:手機篩選抽屜", () => {
  it("帳戶詳情(手機):外面只有 [篩選];抽屜裡 期間起 / 期間迄 / 類型,[套用] 才改查並標數量,[清除] 回預設", async () => {
    setMobileViewport();
    const types: (string | null | undefined)[] = [];
    const { user } = renderAccounts({ path: "/accounts/view-page/ba-1" });
    server.use(
      api.query("LotteryBankTransactions", ({ variables }) => {
        types.push(
          (variables as LotteryBankTransactionsQueryVariables).input.type,
        );
      }),
    );

    const drawer = await openDrawer(user);
    expect(screen.getAllByRole("group", { name: "期間起" })).toHaveLength(1);
    expect(
      within(drawer).getByRole("group", { name: "期間起" }),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByRole("group", { name: "期間迄" }),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole("combobox", { name: "類型" }));
    await user.click(await screen.findByRole("option", { name: "存入" }));
    // 還沒 [套用]:不改查
    expect(types.every((type) => type === undefined)).toBe(true);

    await user.click(within(drawer).getByRole("button", { name: "套用" }));
    await waitFor(() => {
      expect(types.at(-1)).toBe("deposit");
    });
    const again = await openDrawer(user, "篩選 (1)");
    await user.click(within(again).getByRole("button", { name: "清除" }));
    await user.click(within(again).getByRole("button", { name: "套用" }));
    await waitFor(() => {
      expect(types.at(-1)).toBeUndefined();
    });
    expect(
      await screen.findByRole("button", { name: "篩選" }),
    ).toBeInTheDocument();
  });

  it("即時現金帳(手機):分店選擇器在外面、[篩選] 同一列;抽屜裡 類型 / 收銀點 / 日期,[套用] 才改查", async () => {
    setMobileViewport();
    const types: (string | null | undefined)[] = [];
    const { user } = renderAccounts();
    server.use(
      api.query("LotteryCashLedger", ({ variables }) => {
        types.push((variables as LotteryCashLedgerQueryVariables).input.type);
      }),
    );
    await user.click(await screen.findByRole("tab", { name: "即時現金帳" }));
    expect(await screen.findByText("48,200")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "類型" })).toBeNull();

    const drawer = await openDrawer(user);
    expect(
      within(drawer).getByRole("combobox", { name: "收銀點" }),
    ).toBeInTheDocument();
    expect(
      within(drawer).getByRole("group", { name: "日期" }),
    ).toBeInTheDocument();
    await user.click(within(drawer).getByRole("combobox", { name: "類型" }));
    await user.click(await screen.findByRole("option", { name: "投庫" }));
    expect(types.every((type) => type === undefined)).toBe(true);

    await user.click(within(drawer).getByRole("button", { name: "套用" }));
    await waitFor(() => {
      expect(types.at(-1)).toBe("deposit");
    });
    expect(
      await screen.findByRole("button", { name: "篩選 (1)" }),
    ).toBeInTheDocument();
  });

  it("即時現金帳(手機):[清除] 只清抽屜裡的欄位,分店保留", async () => {
    setMobileViewport();
    const inputs: LotteryCashLedgerQueryVariables["input"][] = [];
    const cash = encodeURIComponent(
      JSON.stringify({ org: "org-store-b", type: "deposit" }),
    );
    const { user } = renderAccounts({
      path: `/accounts?tab=cash&cash=${cash}`,
    });
    server.use(
      api.query("LotteryCashLedger", ({ variables }) => {
        inputs.push((variables as LotteryCashLedgerQueryVariables).input);
      }),
    );
    const drawer = await openDrawer(user, "篩選 (1)");
    await user.click(within(drawer).getByRole("button", { name: "清除" }));
    await user.click(within(drawer).getByRole("button", { name: "套用" }));
    await waitFor(() => {
      expect(inputs.at(-1)?.type).toBeUndefined();
    });
    expect(inputs.at(-1)?.orgId).toBe("org-store-b");
  });

  it.each([
    ["平板", 768],
    ["電腦", 1440],
  ])(
    "%s:兩個清單的篩選欄位都攤在外面,沒有 [篩選] 按鈕",
    async (_label, width) => {
      setViewportWidth(width);
      const { user } = renderAccounts({ path: "/accounts/view-page/ba-1" });
      expect(
        await screen.findByRole("group", { name: "期間起" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: "類型" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^篩選/ })).toBeNull();

      await user.click(
        await screen.findByRole("button", { name: "← 返回列表" }),
      );
      await user.click(await screen.findByRole("tab", { name: "即時現金帳" }));
      expect(
        await screen.findByRole("combobox", { name: "收銀點" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("group", { name: "日期" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^篩選/ })).toBeNull();
    },
  );
});
