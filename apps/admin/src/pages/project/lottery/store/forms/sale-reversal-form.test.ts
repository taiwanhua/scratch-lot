import { describe, expect, it } from "@jest/globals";

import {
  addTicket,
  frontCodeOfTicketKey,
  invalidFieldsOf,
  refundAmountOf,
  removeGroup,
  removeMatchTicket,
  reversalScanKindOf,
  saleReversalStoredValues,
  setGroupTickets,
} from "./sale-reversal-form";

const book = {
  bookId: "b-1",
  gameCode: "5164",
  gameName: "發大財",
  bookNo: "0056527",
  unitPrice: 200,
};

const other = { ...book, bookId: "b-2", bookNo: "0056528" };

const item = (
  status: string,
  unmatched = false,
  blockReason: string | null = null,
) => ({ status, unmatched, blockReason });

describe("撤銷售出申請新增頁的狀態(規格 8.5)", () => {
  it("刷到的張依本分組:同一本併在一起、張號排序去重", () => {
    let groups = addTicket([], book, "016");
    groups = addTicket(groups, book, "012");
    groups = addTicket(groups, other, "001");
    groups = addTicket(groups, book, "012");
    expect(groups.map((group) => [group.bookId, group.ticketNos])).toEqual([
      ["b-1", ["012", "016"]],
      ["b-2", ["001"]],
    ]);
    expect(refundAmountOf(groups)).toBe(600);
    expect(
      setGroupTickets(groups, "b-2", ["003", "002"]).at(1)?.ticketNos,
    ).toEqual(["002", "003"]);
    expect(removeGroup(groups, "b-1")).toHaveLength(1);
  });

  it("送出前:沒有張、沒選原因、退款 = 是沒有退款班次", () => {
    const state = {
      orgId: "org-1",
      reasonKey: "",
      refund: true,
      refundShiftId: "",
      note: "",
      ticketCashPointId: null,
    };
    expect(invalidFieldsOf(state, [])).toEqual([
      "lines",
      "reason",
      "refundShift",
    ]);
    expect(
      invalidFieldsOf(
        { ...state, reasonKey: "wrong-ticket", refund: false },
        addTicket([], book, "001"),
      ),
    ).toEqual([]);
  });

  it("存值:每本一列(張號區段、張數、金額)、退款 = 否時不帶退款班次", () => {
    const groups = setGroupTickets(addTicket([], book, "012"), "b-1", [
      "012",
      "013",
      "014",
      "020",
    ]);
    let sequence = 0;
    const values = saleReversalStoredValues(
      {
        orgId: "org-1",
        reasonKey: "wrong-ticket",
        refund: false,
        refundShiftId: "shift-1",
        note: " 刷錯 ",
        ticketCashPointId: "cp-a",
      },
      groups,
      () => {
        sequence += 1;
        return `row-${String(sequence)}`;
      },
    );
    expect(values).toEqual({
      branch: "org-1",
      lines: [
        {
          rowId: "row-1",
          line_kind: "by_ticket",
          book: "b-1",
          ticket_nos: "012-014,020",
          tickets: 4,
          cash_point: "cp-a",
          amount: 800,
        },
      ],
      reason: "wrong-ticket",
      refund: "no",
      refund_shift: null,
      note: "刷錯",
      refund_amount: 800,
    });
  });

  it("張數店:刷到不是確定張號的已售 → 送出時對號;編號店只收已售;被鎖住、跳號、報廢、在途、不是本店都不行(張數店規格 7.3)", () => {
    expect(reversalScanKindOf(item("sold", false, "sold"), false)).toBe(
      "certain",
    );
    expect(reversalScanKindOf(item("sold", false, "sold"), true)).toBe(
      "certain",
    );
    expect(reversalScanKindOf(item("sold", true, "sold"), true)).toBe("match");
    expect(reversalScanKindOf(item("unsold"), true)).toBe("match");
    expect(reversalScanKindOf(item("investigating", true), true)).toBe("match");
    expect(reversalScanKindOf(item("unsold"), false)).toBeNull();
    expect(reversalScanKindOf(item("sold", true, "sold"), false)).toBeNull();
    for (const blocked of [
      "locked",
      "skipped",
      "scrapped",
      "in_transit",
      "not_this_store",
    ]) {
      expect(reversalScanKindOf(item("sold", false, blocked), true)).toBeNull();
    }
  });

  it("送出時對號的張與「依遊戲 + 張數」列:存成依張號(張號合在同一本)與依遊戲 + 張數兩種列,金額合計(張數店規格 5.7)", () => {
    let groups = addTicket([], book, "012");
    groups = addTicket(groups, book, "030", "match");
    expect(groups).toEqual([
      expect.objectContaining({ ticketNos: ["012"], matchNos: ["030"] }),
    ]);
    const countRows = [
      {
        rowId: "count-1",
        cashPointId: "cp-a",
        gameId: "g-1",
        gameCode: "5164",
        gameName: "發大財",
        unitPrice: 200,
        count: 2,
      },
    ];
    expect(refundAmountOf(groups, countRows)).toBe(800);
    const values = saleReversalStoredValues(
      {
        orgId: "org-1",
        reasonKey: "stocktake-error",
        refund: false,
        refundShiftId: "",
        note: "",
        ticketCashPointId: null,
      },
      groups,
      () => "row-1",
      countRows,
    );
    expect(values.lines).toEqual([
      {
        rowId: "row-1",
        line_kind: "by_ticket",
        book: "b-1",
        ticket_nos: "012,030",
        tickets: 2,
        cash_point: null,
        amount: 400,
      },
      {
        rowId: "count-1",
        line_kind: "by_count",
        game: "g-1",
        cash_point: "cp-a",
        count: 2,
        amount: 400,
      },
    ]);
    expect(values.refund_amount).toBe(800);
    expect(removeMatchTicket(groups, "b-1", "030").at(0)?.matchNos).toEqual([]);
    const state = {
      orgId: "org-1",
      reasonKey: "other",
      refund: false,
      refundShiftId: "",
      note: "",
      ticketCashPointId: null,
    };
    // 只有「依遊戲 + 張數」也可以送;沒選遊戲 → lines
    expect(invalidFieldsOf(state, [], countRows)).toEqual([]);
    expect(
      invalidFieldsOf(
        state,
        [],
        countRows.map((row) => ({ ...row, gameId: "" })),
      ),
    ).toEqual(["lines"]);
  });

  it("張的顯示鍵 → 正面編號(帶入那一張時拿去刷)", () => {
    expect(frontCodeOfTicketKey("5164-056527-012")).toBe("056527-012");
    expect(frontCodeOfTicketKey("亂碼")).toBeNull();
  });
});
