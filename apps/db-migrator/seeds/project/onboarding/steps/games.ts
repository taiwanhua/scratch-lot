import type { OnboardingStep } from "../context";

const GAMES = /* GraphQL */ `
  query OnboardingLotteryGames($input: LotteryGamesInput!) {
    lotteryGames(input: $input) {
      items {
        id
        gameCode
      }
    }
  }
`;

const CREATE_GAME = /* GraphQL */ `
  mutation OnboardingCreateLotteryGame($input: CreateLotteryGameInput!) {
    createLotteryGame(input: $input) {
      item {
        id
      }
    }
  }
`;

/**
 * 遊戲(檔案管理,規格 5.1):以代號找回,已存在就不改(重跑不重建、不覆蓋租戶改過的內容)。
 * 只用檔案管理既有的 GraphQL(`lotteryGames` / `createLotteryGame`)。
 */
export const gamesStep: OnboardingStep = {
  key: "games",
  title: "遊戲",
  run: async ({ client, plan }) => {
    if (plan.games.length === 0) {
      return ["沒有要建立的遊戲"];
    }
    const lines: string[] = [];
    for (const game of plan.games) {
      const { lotteryGames } = await client.request<{
        lotteryGames: { items: { id: string; gameCode: string }[] };
      }>(GAMES, { input: { keyword: game.gameCode, pageSize: 100 } });
      if (lotteryGames.items.some((item) => item.gameCode === game.gameCode)) {
        lines.push(`「${game.gameCode} ${game.name}」已存在`);
        continue;
      }
      await client.request(CREATE_GAME, { input: { ...game } });
      lines.push(`建立「${game.gameCode} ${game.name}」`);
    }
    return lines;
  },
};
