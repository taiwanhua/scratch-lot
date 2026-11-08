import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import {
  inventoryBook,
  inventoryTicket,
  sampleBookDetail,
  sampleInventoryBooks,
} from "@/test/msw/project/lottery/inventory-fixtures";

import { renderInventory } from "./inventory-test-support";

const BOOK = "/inventory/book-page/b-056527";

const grid = () => screen.getByRole("group", { name: "張數格子" });

/**
 * 本 056527 在張數店:#039–040 已售·未對號、#071 待查·未對號(系統預設帶入的張號);#087 ↔ #088 對號、
 * #089 ↔ 別本 #010 對號(Figma CS-20)。
 */
const countBookDetail = () => {
  const base = sampleBookDetail();
  const unmatched = new Set(["039", "040", "071"]);
  return {
    ...base,
    book: { ...base.book, remainingCount: 7, unmatchedCount: 3 },
    tickets: base.tickets.map((ticket) =>
      unmatched.has(ticket.ticketNo)
        ? inventoryTicket(ticket.ticketNo, ticket.status, {
            ...ticket,
            unmatched: true,
          })
        : ticket,
    ),
    events: [
      {
        ...base.events[0],
        at: "2026-10-16T05:00:00.000Z",
        type: "match",
        ticketNos: ["087"],
        matchPartner: {
          __typename: "LotteryInventoryMatchPartner" as const,
          ticketNo: "088",
          bookNo: null,
        },
      },
      {
        ...base.events[0],
        at: "2026-10-16T05:01:00.000Z",
        type: "match",
        ticketNos: ["089"],
        matchPartner: {
          __typename: "LotteryInventoryMatchPartner" as const,
          ticketNo: "010",
          bookNo: "0056528",
        },
      },
      {
        ...base.events[0],
        at: "2026-10-16T05:02:00.000Z",
        type: "scrap_undo",
        ticketNos: ["088"],
        matchPartner: null,
      },
      ...base.events,
    ].map((event, index) =>
      index < 3
        ? {
            ...event,
            reasonKey: null,
            reasonNote: null,
            correctionOfShift: null,
          }
        : { ...event, matchPartner: event.matchPartner ?? null },
    ),
  } as ReturnType<typeof sampleBookDetail>;
};

/** 張數店的庫存、本的詳情、待查·遺失(張數店規格 13.2;Figma CS-20、CS-21、CS-22)。 */
describe("庫存管理:張數店(系統預設帶入的張號)", () => {
  it("本的詳情:頁首「剩 N 張(估算,含未對號 X 張)」、未對號格子虛線不能選、圖例與說明、時間軸「對號 #087 ↔ #088」「撤銷報廢」", async () => {
    const { user } = renderInventory({
      path: BOOK,
      world: { details: [countBookDetail()] },
    });
    expect(
      await screen.findByText(
        "200 元 · 張號 001–102 · 剩 7 張(估算,含未對號 3 張)",
      ),
    ).toBeInTheDocument();
    // 未對號的格子:已售·未對號 / 待查·遺失·未對號(虛線),不能選;確定的待查照樣能選
    expect(
      within(grid()).getByRole("button", { name: "#039 已售·未對號" }),
    ).toBeDisabled();
    expect(
      within(grid()).getByRole("button", { name: "#071 待查·遺失·未對號" }),
    ).toBeDisabled();
    expect(screen.getByText("虛線 = 系統預設帶入的張號")).toBeInTheDocument();
    // 整本尋回不含系統預設帶入的待查(只有確定的待查 / 遺失能尋回)
    expect(
      screen.queryByRole("button", { name: "整本尋回" }),
    ).not.toBeInTheDocument();
    // 時間軸:對號寫另一張(別本帶本號)、撤銷報廢
    expect(screen.getByText("#087 ↔ #088")).toBeInTheDocument();
    expect(screen.getByText("#089 ↔ 本號 056528 #010")).toBeInTheDocument();
    expect(screen.getAllByText("對號")).toHaveLength(2);
    expect(screen.getByText("撤銷報廢")).toBeInTheDocument();
    await user.click(within(grid()).getByRole("button", { name: /^#090 / }));
    expect(await screen.findByText("已選 1 張 #090")).toBeInTheDocument();
  });

  it("編號店的本(沒有未對號):頁首不寫剩幾張、圖例沒有虛線", async () => {
    renderInventory({ path: BOOK });
    expect(
      await screen.findByText("200 元 · 張號 001–102"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("虛線 = 系統預設帶入的張號"),
    ).not.toBeInTheDocument();
  });

  it("庫存列表:有系統預設帶入的張的本,剩餘標「約」、欄名「剩餘 / 總張數(約)」", async () => {
    const books = sampleInventoryBooks();
    renderInventory({
      world: {
        books: [
          inventoryBook({
            id: "b-count",
            bookNo: "0056599",
            remainingCount: 7,
            unmatchedCount: 3,
          }),
          ...books,
        ],
      },
    });
    expect(await screen.findByText("約 7 / 100")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "剩餘 / 總張數(約)" }),
    ).toBeInTheDocument();
  });

  it("待查·遺失:未對號一列(本「—」、張號「系統預設帶入」、來源「10/16 交班盤點」)沒有 [尋回];點一下展開看本與張號", async () => {
    const { user } = renderInventory();
    await user.click(await screen.findByRole("tab", { name: "待查·遺失" }));
    const label = await screen.findByText("系統預設帶入");
    const row = label.closest("tr");
    if (row === null) {
      throw new Error("no row");
    }
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).getByText("10/16 交班盤點")).toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: "尋回" }),
    ).not.toBeInTheDocument();
    await user.click(label);
    expect(
      await screen.findByText(
        "本號 056527 · #090(系統預設帶入)· 這是系統預設帶入的張號,找到實體請刷條碼尋回,或做全店重刷。",
      ),
    ).toBeInTheDocument();
    // 再點一下收起
    await user.click(label);
    expect(
      screen.queryByText(/這是系統預設帶入的張號,找到實體請刷條碼尋回/),
    ).not.toBeInTheDocument();
  });
});
