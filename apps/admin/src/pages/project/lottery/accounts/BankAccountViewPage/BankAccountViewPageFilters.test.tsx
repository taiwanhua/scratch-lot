import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import type { LotteryBankTransactionsQueryVariables } from "@repo/graphql";

import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";
import { api, server } from "@/test/msw/server";

import { renderAccounts } from "../accounts-test-support";

const TZ = "Asia/Taipei";

/**
 * 銀行帳戶詳情的期間篩選(0-18 同一類:鍵盤打年份被蓋掉):
 * 期間起沒寫進網址時畫面是月初;打到一半不能被換回月初,查詢也不能帶不完整的日期。
 */
describe("銀行帳戶詳情:期間篩選的鍵盤輸入", () => {
  it("期間起逐位打年份:看得到 0020 等中間值,查詢維持月初,打滿才改查那一年", async () => {
    const froms: (string | null | undefined)[] = [];
    const { user } = renderAccounts({ path: "/accounts/view-page/ba-1" });
    // 先列的先贏:只記下查詢條件,回應交給帳戶場景的假伺服器
    server.use(
      api.query("LotteryBankTransactions", ({ variables }) => {
        froms.push(
          (variables as LotteryBankTransactionsQueryVariables).input.from,
        );
      }),
    );

    const field = await screen.findByRole("group", { name: "期間起" });
    const year = within(field).getByRole("spinbutton", { name: "Year" });
    const today = localDayTextOf(new Date(), TZ) ?? "";
    const monthStart = `${today.slice(0, 8)}01`;
    expect(field).toHaveTextContent(monthStart);

    await user.click(year);
    const typed: (string | null)[] = [];
    for (const key of "2025") {
      await user.keyboard(key);
      typed.push(
        within(field).getByRole("spinbutton", { name: "Year" }).textContent,
      );
    }
    expect(typed).toEqual(["0002", "0020", "0202", "2025"]);

    const expected = localDayInstantOf(`2025${monthStart.slice(4)}`, TZ);
    await waitFor(() => {
      expect(froms.at(-1)).toBe(expected);
    });
    // 打到一半沒有送出別的查詢:只有月初(重查)與打滿後的那一天
    const allowed = new Set([localDayInstantOf(monthStart, TZ), expected]);
    expect(froms.every((from) => allowed.has(from ?? null))).toBe(true);
  });
});
