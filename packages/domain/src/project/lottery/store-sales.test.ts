import { describe, expect, it } from "@jest/globals";

import {
  type StoreScanContext,
  type StoreScanTicketFacts,
  changedAfterSaleOf,
  saleUndoBlockOf,
  splitPlanProblemOf,
  storeScanDecisionOf,
  storeScanMatchPlacesOf,
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
      match: false,
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
      match: false,
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

describe("張數店刷到時:對號(張數店規格 6.3、6.4、6.5、6.7;16.3 M1–M7)", () => {
  const count: StoreScanContext = { ...selling, countMode: "count" };
  const atLocal = {
    locationKind: "counter" as const,
    cashPointId: "counter",
    counterShiftIsMine: true,
  };

  it("編號店不對號:未對號記號不看,位置不同照現況走移櫃並售出(M3 編號店照舊)", () => {
    const other = {
      ...onLocal,
      cashPointId: "stall",
      counterShiftIsMine: false,
    };
    expect(storeScanMatchPlacesOf(other, selling)).toBeNull();
    expect(storeScanDecisionOf(other, selling, atLocal)).toEqual({
      outcome: "move_and_sell",
      blockReason: null,
      match: false,
    });
  });

  it("系統未售但位置 ≠ 刷的台:只在刷的台找配對;有 → 換位置後賣(不需 store.move)(M3)", () => {
    const other = {
      ...onLocal,
      cashPointId: "stall",
      counterShiftIsMine: false,
    };
    expect(storeScanMatchPlacesOf(other, count)).toEqual([
      { locationKind: "counter", cashPointId: "counter" },
    ]);
    expect(
      storeScanDecisionOf(other, { ...count, canMove: false }, atLocal),
    ).toEqual({ outcome: "sell", blockReason: null, match: true });
  });

  it("已售·未對號:先找刷的台、找不到再找系統記的位置(M2);有 → 對號後賣", () => {
    const sold = {
      ...onLocal,
      status: "sold" as const,
      unmatched: true,
      cashPointId: "stall",
    };
    expect(storeScanMatchPlacesOf(sold, count)).toEqual([
      { locationKind: "counter", cashPointId: "counter" },
      { locationKind: "counter", cashPointId: "stall" },
    ]);
    expect(storeScanDecisionOf(sold, count, atLocal)).toEqual({
      outcome: "sell",
      blockReason: null,
      match: true,
    });
  });

  it("已售·未對號找不到配對 → 擋 unmatched_no_partner(M4)", () => {
    const sold = { ...onLocal, status: "sold" as const, unmatched: true };
    expect(storeScanDecisionOf(sold, count)).toEqual({
      outcome: "blocked",
      blockReason: "unmatched_no_partner",
      match: false,
    });
  });

  it("待查 / 遺失·未對號:有配對 → 對號後賣;沒有 → 尋回(M4)", () => {
    for (const status of ["investigating", "lost"] as const) {
      const missing = { ...onLocal, status, unmatched: true };
      expect(storeScanDecisionOf(missing, count, atLocal)).toEqual({
        outcome: "sell",
        blockReason: null,
        match: true,
      });
      expect(storeScanDecisionOf(missing, count).outcome).toBe("recover");
      // 對號後仍在庫存 → 賣不了,回尋回
      expect(
        storeScanDecisionOf(missing, count, {
          locationKind: "stock",
          cashPointId: null,
          counterShiftIsMine: false,
        }),
      ).toEqual({ outcome: "recover", blockReason: null, match: true });
    }
  });

  it("確定的待查 / 遺失(不是未對號)照現況提示尋回、不對號", () => {
    const missing = { ...onLocal, status: "investigating" as const };
    expect(storeScanMatchPlacesOf(missing, count)).toBeNull();
    expect(storeScanDecisionOf(missing, count, atLocal).outcome).toBe(
      "recover",
    );
  });

  it("被鎖定 → locked,不對號(M6);跳號 / 報廢 → 擋下(M7)", () => {
    const sold = { ...onLocal, status: "sold" as const, unmatched: true };
    expect(storeScanMatchPlacesOf({ ...sold, locked: true }, count)).toBeNull();
    expect(
      storeScanDecisionOf({ ...sold, locked: true }, count, atLocal),
    ).toEqual({ outcome: "blocked", blockReason: "locked", match: false });
    for (const status of ["skipped", "scrapped"] as const) {
      expect(
        storeScanDecisionOf({ ...onLocal, status }, count, atLocal),
      ).toEqual({ outcome: "blocked", blockReason: status, match: false });
    }
  });

  it("不是本店 → 照現況(不跨店對號,M6);在庫存、本已拆 → in_stock(7.1)", () => {
    const sold = { ...onLocal, status: "sold" as const, unmatched: true };
    expect(
      storeScanMatchPlacesOf({ ...sold, inThisStore: false }, count),
    ).toBeNull();
    expect(
      storeScanDecisionOf({ ...sold, inThisStore: false }, count, atLocal),
    ).toEqual({
      outcome: "blocked",
      blockReason: "not_this_store",
      match: false,
    });
    const stock = {
      ...onLocal,
      locationKind: "stock" as const,
      cashPointId: null,
    };
    expect(storeScanMatchPlacesOf(stock, count)).toBeNull();
    expect(storeScanDecisionOf(stock, count).blockReason).toBe("in_stock");
  });

  it("轉換中照張數店規則對號(9.2)", () => {
    const sold = { ...onLocal, status: "sold" as const, unmatched: true };
    expect(
      storeScanDecisionOf(sold, { ...count, countMode: "converting" })
        .blockReason,
    ).toBe("unmatched_no_partner");
  });

  it("沒有本機收銀點:已售·未對號只找系統記的位置", () => {
    const sold = { ...onLocal, status: "sold" as const, unmatched: true };
    expect(
      storeScanMatchPlacesOf(sold, { ...count, localCashPointId: null }),
    ).toEqual([{ locationKind: "counter", cashPointId: "counter" }]);
  });
});

describe("對號不算「售出之後有異動」(張數店規格 7.3、14.1;16.4 U5)", () => {
  it("只有對號 → 不算;有別的事件 → 算", () => {
    expect(changedAfterSaleOf([])).toBe(false);
    expect(changedAfterSaleOf(["match"])).toBe(false);
    expect(changedAfterSaleOf(["match", "move"])).toBe(true);
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
