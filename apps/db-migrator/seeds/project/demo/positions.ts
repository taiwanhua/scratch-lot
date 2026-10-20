import type { OnboardingPosition } from "../onboarding/plan";

/**
 * 示範機構自訂的崗位(專案規格 2.2):示範「預設崗位不夠時租戶自己加」。
 * 收銀點「彩券機旁」對應崗位「彩券機旁」(收銀點由檔案管理的票追加)。
 * 顏色從標籤色票選(規格 18.5),避開專案預設崗位的 blue / green / orange。
 */
export const DEMO_POSITIONS: readonly OnboardingPosition[] = [
  { value: "counter-a", label: "櫃台 A", color: "cyan" },
  { value: "counter-b", label: "櫃台 B", color: "purple" },
  { value: "lottery-machine-side", label: "彩券機旁", color: "pink" },
];
