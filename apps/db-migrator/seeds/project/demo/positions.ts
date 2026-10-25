import type { OnboardingPosition } from "../onboarding/plan";

/**
 * 示範機構的崗位(專案規格 2.2):專案 seed 不內建崗位,示範機構和真正開通的租戶一樣自己建。
 * 兩家店各有一個同名的收銀點,崗位和收銀點一對一(`cash-points.ts`)。
 * 顏色從標籤色票選(規格 18.5)。
 */
export const DEMO_POSITIONS: readonly OnboardingPosition[] = [
  { value: "in-store-counter-a", label: "店內櫃台A", color: "blue" },
  { value: "outdoor-counter-b", label: "店外櫃台B", color: "green" },
];
