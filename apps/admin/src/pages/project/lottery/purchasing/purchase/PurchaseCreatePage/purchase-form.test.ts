import { describe, expect, it } from "@jest/globals";

import {
  type PurchaseGame,
  type ScannedBook,
  addScannedBook,
  groupBooks,
  parseRate,
  purchaseTotalOf,
  purchaseValuesOf,
  requisitionProgressOf,
  setBookRate,
  setGroupRate,
  toggleRedemption,
} from "./purchase-form";

const HOT: PurchaseGame = {
  __typename: "LotteryPurchaseGame",
  id: "g-5164",
  gameCode: "5164",
  name: "發大財",
  unitPrice: 200,
  ticketsPerBook: 100,
  bookPrice: 20_000,
  defaultRate: 92,
};
const GOLD: PurchaseGame = {
  ...HOT,
  id: "g-5201",
  gameCode: "5201",
  name: "金好運",
  unitPrice: 100,
  bookPrice: 10_000,
};
const GAMES = [HOT, GOLD];

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `row-${String(sequence)}`;
};

const added = (result: ReturnType<typeof addScannedBook>): ScannedBook[] => {
  if (result.kind !== "added") {
    throw new Error(result.kind);
  }
  return result.books;
};

describe("刷條碼加一本(規格 8.2;PU-05)", () => {
  it("背面編號帶遊戲代號:本號補成 7 位、最後張號 = 刷到的張號、批購金額率 = 遊戲預設", () => {
    const books = added(
      addScannedBook([], "5164-1-056527-102-0-6", GAMES, null, nextId),
    );
    expect(books[0]).toMatchObject({
      gameId: "g-5164",
      bookNo: "0056527",
      lastTicketNo: 102,
      rate: 92,
    });
  });

  it("正面條碼沒有遊戲代號:用先選的遊戲;沒選 → 要先選遊戲", () => {
    expect(addScannedBook([], "0060116100", GAMES, null, nextId)).toEqual({
      kind: "no_game",
    });
    const books = added(
      addScannedBook([], "0060116100", GAMES, "g-5201", nextId),
    );
    expect(books[0]).toMatchObject({ gameId: "g-5201", bookNo: "0060116" });
  });

  it("同一本刷兩次 → 重複;不是販售中的遊戲代號 → 找不到;看不懂的碼 → invalid", () => {
    const books = added(
      addScannedBook([], "5164-1-056527-100-0-6", GAMES, null, nextId),
    );
    expect(
      addScannedBook(books, "5164-1-056527-100-0-6", GAMES, null, nextId),
    ).toEqual({ kind: "duplicate", bookNo: "056527" });
    expect(
      addScannedBook([], "4980-1-056527-100-0-6", GAMES, null, nextId),
    ).toEqual({ kind: "unknown_game", gameCode: "4980" });
    expect(addScannedBook([], "abc", GAMES, null, nextId)).toEqual({
      kind: "invalid",
    });
  });
});

describe("依遊戲分組、批購金額率、叫貨單帶入", () => {
  const books: ScannedBook[] = [
    {
      rowId: "a",
      gameId: "g-5164",
      bookNo: "0056527",
      lastTicketNo: 100,
      rate: 92,
    },
    {
      rowId: "b",
      gameId: "g-5201",
      bookNo: "0060116",
      lastTicketNo: 100,
      rate: 92,
    },
    {
      rowId: "c",
      gameId: "g-5164",
      bookNo: "0056528",
      lastTicketNo: 102,
      rate: 92,
    },
  ];

  it("同遊戲一組、組小計;逐本改率 → 那一列標色;整組改 → 整組都改", () => {
    const groups = groupBooks(setBookRate(books, "c", 90), GAMES, null);
    expect(groups.map((group) => group.game.gameCode)).toEqual([
      "5164",
      "5201",
    ]);
    expect(groups[0]?.rows.map((row) => row.amount)).toEqual([18_400, 18_000]);
    expect(groups[0]?.rows.map((row) => row.isRateEdited)).toEqual([
      false,
      true,
    ]);
    expect(groups[0]?.subtotal).toBe(36_400);
    const whole = groupBooks(setGroupRate(books, "g-5164", 91), GAMES, null);
    expect(whole[0]?.rows.map((row) => row.rate)).toEqual([91, 91]);
    expect(purchaseTotalOf(groupBooks(books, GAMES, null))).toBe(46_000);
  });

  it("從叫貨單帶入:叫貨 5,已刷 2;叫了還沒刷到的遊戲也列一組", () => {
    const groups = groupBooks(
      books.filter((book) => book.gameId === "g-5164"),
      GAMES,
      new Map([
        ["g-5164", 4],
        ["g-5201", 1],
      ]),
    );
    expect(
      groups.map((group) => [group.game.gameCode, group.rows.length]),
    ).toEqual([
      ["5164", 2],
      ["5201", 0],
    ]);
    expect(requisitionProgressOf(groups)).toEqual({ requested: 5, scanned: 2 });
    expect(requisitionProgressOf(groupBooks(books, GAMES, null))).toBeNull();
  });

  it("批購金額率輸入只收 0–100 的整數", () => {
    expect(parseRate("90")).toBe(90);
    expect(parseRate("")).toBeNull();
    expect(parseRate("101")).toBeNull();
    expect(parseRate("9.5")).toBeNull();
  });

  it("存值:單頭 + 明細(張數、整本金額照遊戲);本人批購時不送受託人", () => {
    const values = purchaseValuesOf(
      {
        branchId: "org-a",
        requisitionNo: "R-0042",
        dealerId: "d1",
        selfPurchase: true,
        trusteeId: "c1",
        purchaseDate: "2026-10-12T16:00:00.000Z",
        accountId: "acc-1",
        note: "  ",
      },
      groupBooks(books.slice(0, 1), GAMES, null),
    );
    expect(values).toEqual({
      branch: "org-a",
      requisition: "R-0042",
      dealer: "d1",
      self_purchase: true,
      trustee: null,
      purchase_date: "2026-10-12T16:00:00.000Z",
      account: "acc-1",
      note: null,
      lines: [
        {
          rowId: "a",
          game: { id: "g-5164", label: "發大財" },
          book_no: "0056527",
          last_ticket_no: 100,
          tickets: 100,
          book_price: 20_000,
          rate: 92,
        },
      ],
      redemptions: [],
    });
  });

  it("兌獎:勾 / 再按取消;存值帶引用(張編號)與中獎金額", () => {
    let sequence = 0;
    const next = () => {
      sequence += 1;
      return `r${String(sequence)}`;
    };
    const one = { id: "rd-1", label: "5164-056527-012", prizeAmount: 1000 };
    const two = { id: "rd-2", label: "5150-042210-083", prizeAmount: 2000 };
    let picked = toggleRedemption([], one, next);
    picked = toggleRedemption(picked, two, next);
    expect(picked.map((item) => item.id)).toEqual(["rd-1", "rd-2"]);
    picked = toggleRedemption(picked, one, next);
    expect(picked).toEqual([{ ...two, rowId: "r2" }]);
    const values = purchaseValuesOf(
      {
        branchId: "org-a",
        requisitionNo: null,
        dealerId: "d1",
        selfPurchase: true,
        trusteeId: null,
        purchaseDate: null,
        accountId: "acc-1",
        note: "",
      },
      [],
      picked,
    );
    expect(values.redemptions).toEqual([
      {
        rowId: "r2",
        redemption: { id: "rd-2", label: "5150-042210-083" },
        prize_amount: 2000,
      },
    ]);
  });
});
