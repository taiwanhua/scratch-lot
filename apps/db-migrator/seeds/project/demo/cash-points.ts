import type { OnboardingCashPoint } from "../onboarding/plan";

/**
 * 示範收銀點(檔案管理,規格 5.5、2.2):中山店用專案預設崗位 + 自訂崗位「彩券機旁」
 * (示範「預設崗位不夠時租戶自己加」);信義店用自訂崗位 櫃台 A、櫃台 B。
 */
export const DEMO_CASH_POINTS: readonly OnboardingCashPoint[] = [
  {
    branch: "中山店",
    positionKey: "in-store-counter",
    name: "店內櫃台",
    order: 1,
  },
  {
    branch: "中山店",
    positionKey: "outdoor-stall",
    name: "店外攤位",
    order: 2,
  },
  {
    branch: "中山店",
    positionKey: "lottery-machine-side",
    name: "彩券機旁",
    order: 3,
  },
  { branch: "信義店", positionKey: "counter-a", name: "櫃台 A", order: 1 },
  { branch: "信義店", positionKey: "counter-b", name: "櫃台 B", order: 2 },
];
