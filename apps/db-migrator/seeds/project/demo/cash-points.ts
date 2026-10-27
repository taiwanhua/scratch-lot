import type { OnboardingCashPoint } from "../onboarding/plan";

/**
 * 示範收銀點(檔案管理,規格 5.5、2.2):兩家店都是「店內櫃台A」「店外櫃台B」各一個,
 * 名稱同崗位,崗位和收銀點一對一(`positions.ts`)。
 */
export const DEMO_CASH_POINTS: readonly OnboardingCashPoint[] = [
  {
    branch: "中山店",
    positionKey: "in-store-counter-a",
    name: "店內櫃台A",
    order: 1,
  },
  {
    branch: "中山店",
    positionKey: "outdoor-counter-b",
    name: "店外櫃台B",
    order: 2,
  },
  {
    branch: "信義店",
    positionKey: "in-store-counter-a",
    name: "店內櫃台A",
    order: 1,
  },
  {
    branch: "信義店",
    positionKey: "outdoor-counter-b",
    name: "店外櫃台B",
    order: 2,
  },
];
