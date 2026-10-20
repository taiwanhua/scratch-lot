import type { OnboardingStep } from "./context";
import { branchesStep } from "./steps/branches";
import { cashPointsStep } from "./steps/cash-points";
import { classBDealersStep } from "./steps/class-b-dealers";
import { notificationRecipientsStep } from "./steps/notification-recipients";
import { orgVisibilityStep } from "./steps/org-visibility";
import { positionsStep } from "./steps/positions";
import { rolesStep } from "./steps/roles";
import { scheduleStaffStep, scheduleTemplatesStep } from "./steps/schedule";
import { tenantStep } from "./steps/tenant";
import { usersStep } from "./steps/users";

/**
 * 開通腳本的步驟,**依序**執行(開通清單正本 `docs/modules/project/lottery-onboarding.md`)。
 *
 * 追加方式:模組 / 表單票在 `steps/` 新增自己的一步(冪等、只用該模組既有的 GraphQL),
 * 在下面的清單**按依賴插入一行**(例:收銀點要在「崗位」之後;表單的流程要在「角色」之後),
 * 並在開通清單把那一列的「開通 skill」欄改成「自動」。不改別人的步驟。
 */
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  tenantStep,
  orgVisibilityStep,
  branchesStep,
  rolesStep,
  usersStep,
  positionsStep,
  classBDealersStep,
  scheduleStaffStep,
  scheduleTemplatesStep,
  notificationRecipientsStep,
  // 檔案管理:收銀點(要在分店、崗位之後)。遊戲不在開通清單裡,只有示範資料建(`demo/games.ts`)
  cashPointsStep,
];
