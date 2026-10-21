import { describe, expect, it } from "@jest/globals";

import {
  type DailyCloseDraft,
  addLocalDays,
  bankDepositProblemOf,
  checkoutDraftTypeOf,
  dailyCloseGapDates,
  dailyCloseOverdueAt,
  localDaysBetween,
  parseDailyCloseDraft,
  serializeDailyCloseDraft,
} from "./daily-close";

const draft: DailyCloseDraft = {
  version: 1,
  type: "daily",
  orgId: "org-1",
  stocktake: {
    mode: "new",
    draft: {
      version: 1,
      orgId: "org-1",
      scopeCashPointId: null,
      startedAt: "2026-10-16T13:40:00.000Z",
      lines: [],
      unopened: [],
      lostReview: [],
    },
  },
  denominations: [
    { value: 1000, count: 20 },
    { value: 500, count: 6 },
  ],
  diffReasonKey: null,
  diffReasonNote: null,
  bankDeposit: { amount: 20_000, accountId: "acc-1" },
};

const d = (text: string) => {
  const [year, month, day] = text.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
};

describe("日結的結帳內容", () => {
  it("序列化後讀得回來;交班 / 日結分得出來", () => {
    const text = serializeDailyCloseDraft(draft);
    expect(parseDailyCloseDraft(text)).toEqual({ ok: true, draft });
    expect(checkoutDraftTypeOf(text)).toBe("daily");
    expect(checkoutDraftTypeOf('{"type":"shift"}')).toBe("shift");
    expect(checkoutDraftTypeOf("not json")).toBeNull();
  });

  it("形狀不對 → 讀不懂", () => {
    expect(parseDailyCloseDraft({ ...draft, type: "shift" }).ok).toBe(false);
    expect(
      parseDailyCloseDraft({ ...draft, bankDeposit: { amount: "1" } }).ok,
    ).toBe(false);
    expect(
      parseDailyCloseDraft({ ...draft, stocktake: { mode: "x" } }).ok,
    ).toBe(false);
  });
});

describe("存入銀行的檢查", () => {
  it("0 = 不存;> 0 要帳戶;不能超過可存的錢;不是非負整數擋下", () => {
    expect(
      bankDepositProblemOf({ amount: 0, accountId: null, available: 100 }),
    ).toBeNull();
    expect(
      bankDepositProblemOf({ amount: 50, accountId: null, available: 100 }),
    ).toBe("account_required");
    expect(
      bankDepositProblemOf({ amount: 150, accountId: "a", available: 100 }),
    ).toBe("exceeds_available");
    expect(
      bankDepositProblemOf({ amount: -1, accountId: "a", available: 100 }),
    ).toBe("invalid_amount");
    expect(
      bankDepositProblemOf({ amount: 1.5, accountId: "a", available: 100 }),
    ).toBe("invalid_amount");
  });
});

describe("涵蓋計算期間沒有日結的日子", () => {
  it("10/14 09:02 日結、今天 10/16 → 10/14、10/15 沒有日結", () => {
    expect(dailyCloseGapDates(d("2026-10-14"), d("2026-10-16"))).toEqual([
      d("2026-10-14"),
      d("2026-10-15"),
    ]);
  });

  it("上一次日結就是今天 → 沒有;從來沒日結 → 沒有;跨月", () => {
    expect(dailyCloseGapDates(d("2026-10-16"), d("2026-10-16"))).toEqual([]);
    expect(dailyCloseGapDates(null, d("2026-10-16"))).toEqual([]);
    expect(dailyCloseGapDates(d("2026-10-31"), d("2026-11-01"))).toEqual([
      d("2026-10-31"),
    ]);
  });

  it("已幾天、加天數", () => {
    expect(localDaysBetween(d("2026-10-13"), d("2026-10-16"))).toBe(3);
    expect(addLocalDays(d("2026-12-31"), 1)).toEqual(d("2027-01-01"));
  });
});

describe("日結逾期的時點", () => {
  it("最早一張交班結帳 10/14 22:10 送出 → 10/15 09:00(台北);可調時間 08:30", () => {
    const at = new Date("2026-10-14T22:10:00+08:00");
    expect(dailyCloseOverdueAt(at, "Asia/Taipei", "09:00").toISOString()).toBe(
      new Date("2026-10-15T09:00:00+08:00").toISOString(),
    );
    expect(dailyCloseOverdueAt(at, "Asia/Taipei", "08:30").toISOString()).toBe(
      new Date("2026-10-15T08:30:00+08:00").toISOString(),
    );
  });
});
