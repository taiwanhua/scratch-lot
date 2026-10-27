import { describe, expect, it } from "@jest/globals";

import {
  type TransferBookOption,
  addPartial,
  addWhole,
  bookOfScan,
  lineAmountOf,
  linePurchaseAmountOf,
  removeLine,
  setLineRate,
  transferTotalOf,
  transferValuesOf,
} from "./transfer-form";

const book = (
  bookId: string,
  isWhole: boolean,
  overrides: Partial<TransferBookOption> = {},
): TransferBookOption => ({
  __typename: "LotteryTransferBook",
  bookId,
  gameId: "game-5164",
  gameCode: "5164",
  gameName: "發大財",
  bookNo: "0056527",
  unitPrice: 200,
  bookPrice: 20_000,
  rate: 92,
  isWhole,
  availableCount: 100,
  lastTicketNo: 100,
  ...overrides,
});

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `row-${String(sequence)}`;
};

describe("調貨單新增頁的純函式(規格 8.4)", () => {
  it("整本加入:金額 = 整本金額、批購金額率預設這一本的成本率;同一本不能再加", () => {
    const whole = book("b1", true);
    const added = addWhole([], whole, nextId);
    expect(added.kind).toBe("added");
    const lines = added.kind === "added" ? added.lines : [];
    expect(lines.map((line) => lineAmountOf(line))).toEqual([20_000]);
    expect(lines.map((line) => linePurchaseAmountOf(line))).toEqual([18_400]);
    expect(addWhole(lines, whole, nextId)).toEqual({ kind: "duplicate" });
    expect(addPartial(lines, whole, ["001"], nextId)).toEqual({
      kind: "duplicate",
    });
  });

  it("選張加入:金額 = 面額 × 張數;同一本再選 → 併成一列;沒選 → empty", () => {
    const opened = book("b2", false);
    expect(addPartial([], opened, [], nextId)).toEqual({ kind: "empty" });
    const first = addPartial([], opened, ["014", "012"], nextId);
    const lines = first.kind === "added" ? first.lines : [];
    const second = addPartial(lines, opened, ["013", "012"], nextId);
    const merged = second.kind === "added" ? second.lines : [];
    expect(merged).toHaveLength(1);
    expect(merged[0]?.ticketNos).toEqual(["012", "013", "014"]);
    expect(merged.map((line) => lineAmountOf(line))).toEqual([600]);
    const rated = setLineRate(merged, merged[0]?.rowId ?? "", 100);
    expect(transferTotalOf(rated)).toBe(600);
    expect(removeLine(rated, rated[0]?.rowId ?? "")).toEqual([]);
  });

  it("刷條碼找本:背面編號比遊戲代號;正面條碼對到多款遊戲同本號 → 請選遊戲", () => {
    const books = [
      book("b1", true),
      book("b3", true, { gameId: "game-5201", gameCode: "5201" }),
      book("b4", true, { bookNo: "0060116" }),
    ];
    expect(bookOfScan(books, "5201-1-056527-010-0-6")).toMatchObject({
      kind: "found",
      book: { bookId: "b3" },
    });
    expect(bookOfScan(books, "0056527010")).toEqual({
      kind: "ambiguous_game",
    });
    expect(bookOfScan(books, "0056527010", "game-5201")).toMatchObject({
      kind: "found",
      book: { bookId: "b3" },
      ticketNo: "010",
    });
    expect(bookOfScan(books, "0060116010")).toMatchObject({
      kind: "found",
      book: { bookId: "b4" },
    });
    expect(bookOfScan(books, "0099999010")).toEqual({ kind: "not_found" });
    expect(bookOfScan(books, "x")).toEqual({ kind: "not_found" });
  });

  it("選張加入:那一列鎖住(編輯頁已出貨 / 已點收)→ 不能併進去", () => {
    const opened = book("b2", false);
    const first = addPartial([], opened, ["012"], nextId);
    const lines = first.kind === "added" ? first.lines : [];
    const lockedRow = new Set([lines[0]?.rowId ?? ""]);
    expect(addPartial(lines, opened, ["013"], nextId, lockedRow)).toEqual({
      kind: "duplicate",
    });
  });

  it("存值:單頭 + 明細(整本的張號 = 起訖、選張 = 區段文字)", () => {
    const whole = addWhole([], book("b1", true), nextId);
    const wholeLines = whole.kind === "added" ? whole.lines : [];
    const both = addPartial(
      wholeLines,
      book("b2", false, { bookNo: "0056528" }),
      ["020", "021", "025"],
      nextId,
    );
    const lines = both.kind === "added" ? both.lines : [];
    expect(
      transferValuesOf(
        { fromBranchId: "A", toBranchId: "B", requisitionNo: null, note: " " },
        lines,
      ),
    ).toMatchObject({
      from_branch: "A",
      to_branch: "B",
      requisition: null,
      note: null,
      lines: [
        { mode: "whole", ticket_nos: "001-100", tickets: 100, amount: 20_000 },
        {
          mode: "partial",
          ticket_nos: "020-021,025",
          tickets: 3,
          amount: 600,
          book: { id: "b2", label: "5164-056528" },
        },
      ],
    });
  });
});

describe("整本列有待標註的跳號(使用者 10/27 定案:「001–101(100 張)」)", () => {
  it("迄號 101、可調 100 張:存值的張號區段到迄號、張數 100、金額照整本", () => {
    const added = addWhole(
      [],
      book("b101", true, { availableCount: 100, lastTicketNo: 101 }),
      nextId,
    );
    const lines = added.kind === "added" ? added.lines : [];
    expect(
      transferValuesOf(
        { fromBranchId: "A", toBranchId: "B", requisitionNo: null, note: "" },
        lines,
      ),
    ).toMatchObject({
      lines: [
        { mode: "whole", ticket_nos: "001-101", tickets: 100, amount: 20_000 },
      ],
    });
  });
});
