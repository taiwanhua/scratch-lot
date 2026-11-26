import { type OnboardingStep, requireBranchId } from "../onboarding/context";

/** 一本示範的期初建檔(`createLotteryOpeningBook` 的 input;張號 3 碼)。 */
export interface DemoOpeningBook {
  gameCode: string;
  /** 7 碼本號(重跑時以「遊戲 + 本號」找回) */
  bookNo: string;
  lastTicketNo: number;
  rate: number;
  /** 導入前已賣出的張(期初已售) */
  soldTicketNos: readonly string[];
  /** 手上的張放哪:收銀點名稱;null = 原封在庫存 */
  cashPoint: string | null;
}

export interface DemoOpening {
  branch: string;
  books: readonly DemoOpeningBook[];
  /** 建完後按 [結束期初建檔] */
  close: boolean;
}

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) =>
    String(from + index).padStart(3, "0"),
  );

/**
 * 示範的期初建檔(期初建檔規格第 6 節):中山店建 2 本 —— 5164 發大財一本拆過(導入前已賣出 #001–#046、
 * 其餘 54 張在店內櫃台A),5201 金好運一本原封在庫存;建完結束期初建檔。信義店不建(看得到「進行中、已建 0 本」)。
 */
export const DEMO_OPENINGS: readonly DemoOpening[] = [
  {
    branch: "中山店",
    books: [
      {
        gameCode: "5164",
        bookNo: "0071201",
        lastTicketNo: 100,
        rate: 92,
        soldTicketNos: range(1, 46),
        cashPoint: "店內櫃台A",
      },
      {
        gameCode: "5201",
        bookNo: "0072301",
        lastTicketNo: 100,
        rate: 92,
        soldTicketNos: [],
        cashPoint: null,
      },
    ],
    close: true,
  },
];

const STATUS = /* GraphQL */ `
  query DemoStoreOpening($orgId: ID!) {
    lotteryStoreOpening(orgId: $orgId) {
      item {
        closed
        books {
          gameCode
          bookNo
        }
        cashPoints {
          id
          name
        }
      }
    }
  }
`;

const GAMES = /* GraphQL */ `
  query DemoOpeningGames($input: LotteryGamesInput!) {
    lotteryGames(input: $input) {
      items {
        id
        gameCode
      }
    }
  }
`;

const CREATE = /* GraphQL */ `
  mutation DemoCreateOpeningBook($input: CreateLotteryOpeningBookInput!) {
    createLotteryOpeningBook(input: $input) {
      bookId
      count
    }
  }
`;

const CLOSE = /* GraphQL */ `
  mutation DemoCloseStoreOpening($orgId: ID!) {
    closeLotteryStoreOpening(orgId: $orgId) {
      item {
        closed
      }
    }
  }
`;

interface OpeningStatus {
  closed: boolean;
  books: { gameCode: string; bookNo: string }[];
  cashPoints: { id: string; name: string }[];
}

type Client = Parameters<OnboardingStep["run"]>[0]["client"];

/** 建一本(已建過就略過);回一行說明。 */
async function createBook(
  client: Client,
  branch: string,
  orgId: string,
  status: OpeningStatus,
  book: DemoOpeningBook,
): Promise<string> {
  const key = `${book.gameCode}-${book.bookNo}`;
  if (
    status.books.some(
      (item) => item.gameCode === book.gameCode && item.bookNo === book.bookNo,
    )
  ) {
    return `${branch}「${key}」已建檔`;
  }
  const { lotteryGames } = await client.request<{
    lotteryGames: { items: { id: string; gameCode: string }[] };
  }>(GAMES, { input: { keyword: book.gameCode, pageSize: 100 } });
  const game = lotteryGames.items.find(
    (item) => item.gameCode === book.gameCode,
  );
  if (game === undefined) {
    throw new Error(`找不到遊戲 ${book.gameCode}(示範遊戲要先建)`);
  }
  const place = book.cashPoint;
  const cashPointId =
    place === null
      ? null
      : status.cashPoints.find((point) => point.name === place)?.id;
  if (cashPointId === undefined) {
    throw new Error(`${branch}找不到收銀點「${place ?? ""}」`);
  }
  const inHand = range(1, book.lastTicketNo).filter(
    (no) => !book.soldTicketNos.includes(no),
  );
  await client.request(CREATE, {
    input: {
      orgId,
      gameId: game.id,
      bookNo: book.bookNo,
      lastTicketNo: book.lastTicketNo,
      rate: book.rate,
      soldTicketNos: [...book.soldTicketNos],
      skippedTicketNos: [],
      placements: [{ cashPointId, ticketNos: inHand }],
    },
  });
  return `${branch}建檔「${key}」:導入前已賣出 ${String(book.soldTicketNos.length)} 張、${place ?? "原封在庫存"} ${String(inHand.length)} 張`;
}

/**
 * **示範資料專用**的一步:期初建檔。開通清單第 13 點是人工步驟(店長或總部在庫存管理建),
 * 所以不放進 `onboarding/steps.ts`。以「遊戲 + 本號」找回,已建過就不再建;已結束就不動。
 * 只用期初建檔既有的 GraphQL(租戶管理員有 `inventory.opening` 與 `lottery-settings.edit-org`)。
 * 要排在遊戲、收銀點之後。
 */
export const demoOpeningStep: OnboardingStep = {
  key: "demo-opening",
  title: "示範期初建檔",
  run: async ({ client, state }) => {
    const lines: string[] = [];
    for (const opening of DEMO_OPENINGS) {
      const orgId = requireBranchId(state, opening.branch);
      const { lotteryStoreOpening } = await client.request<{
        lotteryStoreOpening: { item: OpeningStatus };
      }>(STATUS, { orgId });
      const status = lotteryStoreOpening.item;
      if (status.closed) {
        lines.push(`${opening.branch}的期初建檔已結束`);
        continue;
      }
      for (const book of opening.books) {
        lines.push(
          await createBook(client, opening.branch, orgId, status, book),
        );
      }
      if (opening.close) {
        await client.request(CLOSE, { orgId });
        lines.push(`${opening.branch}結束期初建檔`);
      }
    }
    return lines;
  },
};
