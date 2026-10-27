import {
  DEFAULT_TENANT_TIMEZONE,
  addLocalCalendar,
  toIso,
} from "@repo/domain/form";
import type { TagPaletteKey } from "@repo/domain/project/tag-palette";

import type { OnboardingStep } from "../onboarding/context";

/** 一個示範遊戲(`createLotteryGame` 的 input)。 */
export interface DemoGame {
  /** 4 碼數字 */
  gameCode: string;
  name: string;
  unitPrice: number;
  ticketsPerBook: number;
  /** 預設批購金額率(整數 %) */
  defaultRate: number;
  color: TagPaletteKey | null;
  /**
   * 兌獎截止日 = 跑示範指令當下往後幾個月(api 收斂成租戶時區那一天,並推算上市日 −9 個月、停售日 −3 個月);
   * 9 = 今天上市(看板標【新】)。
   */
  claimDeadlineMonthsAhead: number;
}

/** 示範遊戲(檔案管理,規格 5.1):六種預設面額裡挑幾種,顏色從標籤色票選。 */
export const DEMO_GAMES: readonly DemoGame[] = [
  {
    gameCode: "5201",
    name: "金好運",
    unitPrice: 100,
    ticketsPerBook: 100,
    defaultRate: 92,
    color: "yellow",
    claimDeadlineMonthsAhead: 9,
  },
  {
    gameCode: "5164",
    name: "發大財",
    unitPrice: 200,
    ticketsPerBook: 100,
    defaultRate: 92,
    color: "red",
    claimDeadlineMonthsAhead: 8,
  },
  {
    gameCode: "5198",
    name: "鼠來寶",
    unitPrice: 100,
    ticketsPerBook: 100,
    defaultRate: 92,
    color: "blue",
    claimDeadlineMonthsAhead: 7,
  },
  {
    gameCode: "5150",
    name: "好運旺旺",
    unitPrice: 500,
    ticketsPerBook: 50,
    defaultRate: 92,
    color: "green",
    claimDeadlineMonthsAhead: 6,
  },
  {
    gameCode: "5133",
    name: "招財貓",
    unitPrice: 1000,
    ticketsPerBook: 25,
    defaultRate: 92,
    color: "purple",
    claimDeadlineMonthsAhead: 5,
  },
];

const GAMES = /* GraphQL */ `
  query DemoLotteryGames($input: LotteryGamesInput!) {
    lotteryGames(input: $input) {
      items {
        id
        gameCode
      }
    }
  }
`;

const CREATE_GAME = /* GraphQL */ `
  mutation DemoCreateLotteryGame($input: CreateLotteryGameInput!) {
    createLotteryGame(input: $input) {
      item {
        id
      }
    }
  }
`;

/**
 * **示範資料專用**的一步:建示範遊戲。遊戲不在開通清單裡(真實租戶由總部自己在檔案管理建),
 * 所以這一步不放進 `onboarding/steps.ts`,只由示範指令接在開通步驟後面跑(`demo/index.ts`)。
 * 以代號找回,已存在就不改;只用檔案管理既有的 GraphQL。
 */
export const demoGamesStep: OnboardingStep = {
  key: "demo-games",
  title: "示範遊戲",
  run: async ({ client }) => {
    const lines: string[] = [];
    for (const game of DEMO_GAMES) {
      const { lotteryGames } = await client.request<{
        lotteryGames: { items: { id: string; gameCode: string }[] };
      }>(GAMES, { input: { keyword: game.gameCode, pageSize: 100 } });
      if (lotteryGames.items.some((item) => item.gameCode === game.gameCode)) {
        lines.push(`「${game.gameCode} ${game.name}」已存在`);
        continue;
      }
      const { claimDeadlineMonthsAhead, ...input } = game;
      const claimDeadline = toIso(
        addLocalCalendar(
          Date.now(),
          claimDeadlineMonthsAhead,
          "months",
          DEFAULT_TENANT_TIMEZONE,
        ),
      );
      await client.request(CREATE_GAME, { input: { ...input, claimDeadline } });
      lines.push(`建立「${game.gameCode} ${game.name}」`);
    }
    return lines;
  },
};
