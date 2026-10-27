import { describe, expect, it } from "@jest/globals";

import {
  addTicket,
  frontCodeOfTicketKey,
  invalidFieldsOf,
  refundAmountOf,
  removeGroup,
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
          book: "b-1",
          ticket_nos: "012-014,020",
          tickets: 4,
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

  it("張的顯示鍵 → 正面編號(帶入那一張時拿去刷)", () => {
    expect(frontCodeOfTicketKey("5164-056527-012")).toBe("056527-012");
    expect(frontCodeOfTicketKey("亂碼")).toBeNull();
  });
});
