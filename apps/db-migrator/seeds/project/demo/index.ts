/**
 * 示範機構的資料(專案規格 2.2;正本 `docs/modules/project/lottery-onboarding.md`「示範指令」)。
 *
 * demo 指令(底座機制)以平台管理員建好標「示範」的機構與首任租戶管理員後,呼叫這裡的 `populate`:
 * 把固定的示範資料組成開通資料,交給**同一支開通腳本**(`../onboarding/run-onboarding.ts`)——
 * 示範機構和真正開通的租戶走同一套步驟。示範資料不進一般 seed(ADR-0002)。
 *
 * 追加方式:模組 / 表單票把自己的示範資料放成本目錄的一檔(例:`cash-points.ts`),
 * 在 `demoPlan` 加一行把它放進開通資料;不改別人的檔。不放密碼、不放真實信箱(測試會掃)。
 */
import {
  type DemoSource,
  type DemoTenant,
  aliasEmail,
} from "../../../src/demo/demo-source";
import type { OnboardingPlan } from "../onboarding/plan";
import { runOnboarding } from "../onboarding/run-onboarding";
import { DEMO_CASH_POINTS } from "./cash-points";
import { DEMO_GAMES } from "./games";
import { DEMO_BRANCHES, DEMO_USERS } from "./organization";
import { DEMO_POSITIONS } from "./positions";

/** 示範機構:名稱固定(重跑以它找回同一個機構),短碼全域唯一。 */
export const DEMO_TENANT: DemoTenant = {
  name: "示範彩券行",
  slug: "demo_lottery",
  adminAlias: "demo-admin",
};

/** 示範資料 → 開通資料(信箱由基底信箱加別名產生)。 */
export function demoPlan(emailBase: string): OnboardingPlan {
  return {
    branches: [...DEMO_BRANCHES],
    headquartersBranch: null,
    users: DEMO_USERS.map((user) => {
      const email = aliasEmail(emailBase, user.alias);
      return {
        account: email,
        email,
        name: user.name,
        branches: [...user.branches],
        headquarters: user.headquarters,
        roles: [...user.roles],
      };
    }),
    positions: [...DEMO_POSITIONS],
    games: [...DEMO_GAMES],
    cashPoints: [...DEMO_CASH_POINTS],
  };
}

export const lotteryDemoSource: DemoSource = {
  tenant: DEMO_TENANT,
  populate: ({ client, emailBase, password, print }) =>
    runOnboarding({
      client,
      plan: demoPlan(emailBase),
      activation: { mode: "PASSWORD", password },
      tenantSlug: DEMO_TENANT.slug,
      print,
    }),
};
