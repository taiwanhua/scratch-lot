import type { OnboardingGame } from "../onboarding/plan";

/** 示範遊戲(檔案管理,規格 5.1):六種預設面額裡挑幾種,顏色從標籤色票選。 */
export const DEMO_GAMES: readonly OnboardingGame[] = [
  {
    gameCode: "5201",
    name: "金好運",
    unitPrice: 100,
    ticketsPerBook: 100,
    defaultRate: 92,
    color: "yellow",
  },
  {
    gameCode: "5164",
    name: "發大財",
    unitPrice: 200,
    ticketsPerBook: 100,
    defaultRate: 92,
    color: "red",
  },
  {
    gameCode: "5198",
    name: "鼠來寶",
    unitPrice: 100,
    ticketsPerBook: 100,
    defaultRate: 92,
    color: "blue",
  },
  {
    gameCode: "5150",
    name: "好運旺旺",
    unitPrice: 500,
    ticketsPerBook: 50,
    defaultRate: 92,
    color: "green",
  },
  {
    gameCode: "5133",
    name: "招財貓",
    unitPrice: 1000,
    ticketsPerBook: 25,
    defaultRate: 92,
    color: "purple",
  },
];
