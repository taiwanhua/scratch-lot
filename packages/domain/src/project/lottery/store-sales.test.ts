import { describe, expect, it } from "@jest/globals";

import {
  type StoreScanContext,
  type StoreScanTicketFacts,
  saleUndoBlockOf,
  splitPlanProblemOf,
  storeScanDecisionOf,
} from "./store-sales";

const onLocal: StoreScanTicketFacts = {
  status: "unsold",
  locationKind: "counter",
  cashPointId: "counter",
  inThisStore: true,
  locked: false,
  bookUnopened: false,
  counterShiftIsMine: true,
};

const selling: StoreScanContext = {
  localCashPointId: "counter",
  localShiftOpen: true,
  canSell: true,
  canMove: true,
};

describe("刷到時怎麼處理(規格 6.3、3.3)", () => {
  it("本機收銀點檯面 → 直接售出", () => {
    expect(storeScanDecisionOf(onLocal, selling)).toEqual({
      outcome: "sell",
      blockReason: null,
    });
  });

  it("別的收銀點、那一班是自己開的 → 算那一班(不移櫃)", () => {
    expect(
      storeScanDecisionOf({ ...onLocal, cashPointId: "stall" }, selling)
        .outcome,
    ).toBe("sell_other_mine");
  });

  it("別的收銀點、不是自己的班:有 store.move → 移櫃並售出;沒有 → 擋下", () => {
    const other = {
      ...onLocal,
      cashPointId: "stall",
      counterShiftIsMine: false,
    };
    expect(storeScanDecisionOf(other, selling).outcome).toBe("move_and_sell");
    expect(
      storeScanDecisionOf(other, { ...selling, canMove: false }).outcome,
    ).toBe("move_forbidden");
  });

  it.each([
    [{ inThisStore: false }, "not_this_store"],
    [{ status: "sold" as const }, "sold"],
    [{ status: "skipped" as const }, "skipped"],
    [{ status: "scrapped" as const }, "scrapped"],
    [{ locked: true }, "locked"],
    [{ locationKind: "in_transit" as const, cashPointId: null }, "in_transit"],
    [{ locationKind: "stock" as const, cashPointId: null }, "in_stock"],
  ])("擋下:%o → %s", (patch, reason) => {
    expect(storeScanDecisionOf({ ...onLocal, ...patch }, selling)).toEqual({
      outcome: "blocked",
      blockReason: reason,
    });
  });

  it("待查 / 遺失 → 提示尋回(別家店的也是)", () => {
    for (const status of ["investigating", "lost"] as const) {
      expect(
        storeScanDecisionOf({ ...onLocal, status, inThisStore: false }, selling)
          .outcome,
      ).toBe("recover");
    }
  });

  it("未拆的本 → 詢問拆本", () => {
    expect(
      storeScanDecisionOf(
        {
          ...onLocal,
          locationKind: "stock",
          cashPointId: null,
          bookUnopened: true,
        },
        selling,
      ).outcome,
    ).toBe("unopened");
  });

  it("銷售條件不符 → 只顯示資訊", () => {
    expect(
      storeScanDecisionOf(onLocal, { ...selling, localCashPointId: null })
        .outcome,
    ).toBe("info_only");
    expect(
      storeScanDecisionOf(onLocal, { ...selling, localShiftOpen: false })
        .outcome,
    ).toBe("info_only");
    expect(
      storeScanDecisionOf(onLocal, { ...selling, canSell: false }).outcome,
    ).toBe("info_only");
  });
});

describe("當下撤銷的條件(規格 6.3)", () => {
  const soldAt = new Date("2026-11-05T13:00:00.000Z");
  const facts = {
    soldByMe: true,
    soldAt,
    now: new Date("2026-11-05T13:30:00.000Z"),
    shiftOpen: true,
    changedAfterSale: false,
    undone: false,
  };

  it("自己賣的、30 分鐘內、班開著、之後沒異動 → 可以撤銷", () => {
    expect(saleUndoBlockOf(facts)).toBeNull();
  });

  it("31 分鐘 / 班已結帳 / 不是自己賣的 / 之後有異動 / 已撤銷 → 不行", () => {
    expect(
      saleUndoBlockOf({
        ...facts,
        now: new Date("2026-11-05T13:31:00.000Z"),
      }),
    ).toBe("expired");
    expect(saleUndoBlockOf({ ...facts, shiftOpen: false })).toBe(
      "shift_closed",
    );
    expect(saleUndoBlockOf({ ...facts, soldByMe: false })).toBe("not_mine");
    expect(saleUndoBlockOf({ ...facts, changedAfterSale: true })).toBe(
      "changed",
    );
    expect(saleUndoBlockOf({ ...facts, undone: true })).toBe("already_undone");
  });
});

describe("拆本精靈的檢查(規格 6.4)", () => {
  const nos = ["001", "002", "003", "004"];

  it("跳號點滿、其餘全部分配 → 可以拆", () => {
    expect(
      splitPlanProblemOf(
        nos,
        1,
        ["003"],
        [
          { cashPointId: "a", ticketNos: ["001", "002"] },
          { cashPointId: "b", ticketNos: ["004"] },
        ],
      ),
    ).toBeNull();
  });

  it("待標註 2 張只點 1 張 → 不行", () => {
    expect(
      splitPlanProblemOf(
        nos,
        2,
        ["003"],
        [{ cashPointId: "a", ticketNos: ["001", "002", "004"] }],
      ),
    ).toBe("skip_count_mismatch");
  });

  it("沒分完 / 分兩次 / 分到跳號 → 不行", () => {
    expect(
      splitPlanProblemOf(
        nos,
        0,
        [],
        [{ cashPointId: "a", ticketNos: nos.slice(0, 3) }],
      ),
    ).toBe("unassigned");
    expect(
      splitPlanProblemOf(
        nos,
        0,
        [],
        [
          { cashPointId: "a", ticketNos: nos },
          { cashPointId: "b", ticketNos: ["001"] },
        ],
      ),
    ).toBe("assigned_twice");
    expect(
      splitPlanProblemOf(
        nos,
        1,
        ["001"],
        [{ cashPointId: "a", ticketNos: nos }],
      ),
    ).toBe("assigned_unknown");
  });
});
