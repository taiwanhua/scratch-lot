import { describe, expect, it } from "@jest/globals";

import { bookCountsOf } from "./book-stats";
import { pickForCountSale } from "./count-mode";
import { counterScanDecisionOf, scrapBlockOf } from "./counter-moves";
import { saleReversalPlanOf } from "./sale-reversal-plan";
import { storeScanDecisionOf } from "./store-sales";
import {
  ALLOCATION_OUT_EVENT_TYPES,
  TICKET_EVENT_TYPE,
  isDocumentLock,
} from "./ticket-events";

describe("批售(規格 21.5)", () => {
  it("被單據鎖住 = 調貨單或批售單;撤銷售出申請、沒有鎖不是", () => {
    expect(isDocumentLock("transfer")).toBe(true);
    expect(isDocumentLock("wholesale")).toBe(true);
    expect(isDocumentLock("sale_reversal")).toBe(false);
    expect(isDocumentLock(null)).toBe(false);
  });

  it("批售不扣預計要給本數的「已給」", () => {
    expect(ALLOCATION_OUT_EVENT_TYPES).not.toContain(
      TICKET_EVENT_TYPE.wholesale,
    );
  });

  it("已批售的張數自己一格", () => {
    expect(
      bookCountsOf([{ status: "wholesaled", locationKind: "stock" }]),
    ).toMatchObject({ wholesaled: 1, stock: 0, sold: 0 });
  });

  it.each(["numbered", "count", "converting"] as const)(
    "%s:刷到已批售 → 不能賣;批售中(鎖住的未拆本)→ 鎖定",
    (countMode) => {
      const context = {
        localCashPointId: "a",
        localShiftOpen: true,
        canSell: true,
        canMove: true,
        countMode,
      };
      const ticket = {
        locationKind: "stock" as const,
        cashPointId: null,
        inThisStore: true,
        bookUnopened: false,
        counterShiftIsMine: false,
      };
      expect(
        storeScanDecisionOf(
          { ...ticket, status: "wholesaled", locked: false },
          context,
        ),
      ).toMatchObject({ outcome: "blocked", blockReason: "wholesaled" });
      expect(
        storeScanDecisionOf(
          { ...ticket, status: "unsold", locked: true, bookUnopened: true },
          context,
        ),
      ).toMatchObject({ outcome: "blocked", blockReason: "locked" });
      expect(
        counterScanDecisionOf(
          { ...ticket, status: "wholesaled", unmatched: false, locked: false },
          { countMode, sourceCashPointId: "a", targetCashPointId: null },
          false,
        ).problem,
      ).toBe("wholesaled");
    },
  );

  it("已批售、批售中的張不能報廢、不會被依張數賣挑到(#20)、不能進撤銷申請", () => {
    expect(
      scrapBlockOf({
        status: "wholesaled",
        locationKind: "stock",
        locked: false,
        bookFirstOpenedAt: "opened",
      }),
    ).toBe("not_unsold");
    const books = new Map([["b", { bookNo: "1", firstOpenedAt: new Date() }]]);
    const ticket = { id: "t", bookId: "b", ticketNo: "001" };
    expect(
      pickForCountSale(
        [{ ...ticket, status: "wholesaled", locked: false }],
        books,
        1,
      ),
    ).toEqual({ ok: false, available: 0 });
    expect(
      pickForCountSale(
        [{ ...ticket, status: "unsold", locked: true }],
        books,
        1,
      ),
    ).toEqual({ ok: false, available: 0 });
    expect(
      saleReversalPlanOf({
        matching: true,
        scans: [
          {
            rowId: "r",
            cashPointId: "a",
            ticket: {
              id: "t",
              gameId: "g",
              inStore: true,
              status: "wholesaled",
              unmatched: false,
              locked: false,
              locationKind: "stock",
              cashPointId: null,
              soldAt: null,
              soldSource: null,
            },
          },
        ],
        carriers: [],
        countLines: [],
      }),
    ).toMatchObject({ ok: false, problem: { kind: "not_reversible" } });
  });
});
