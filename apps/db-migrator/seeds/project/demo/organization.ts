import type { OnboardingBranch } from "../onboarding/plan";
import type { OnboardingRoleKey } from "../onboarding/roles";

/** 示範機構的分店(總部就是機構本身,不是某家分店)。 */
export const DEMO_BRANCHES: readonly OnboardingBranch[] = [
  { name: "中山店" },
  { name: "信義店" },
];

/**
 * 示範帳號。信箱 = 基底信箱加 `+<alias>`(`<基底>+demo-hq@…`),帳號同信箱;
 * repo 只放別名,不放任何真實信箱或密碼(密碼 = 執行時輸入的示範密碼,只存雜湊)。
 */
export interface DemoUser {
  alias: string;
  name: string;
  branches: string[];
  headquarters: boolean;
  roles: OnboardingRoleKey[];
}

export const DEMO_USERS: readonly DemoUser[] = [
  {
    alias: "demo-hq",
    name: "示範總部人員",
    branches: [],
    headquarters: true,
    roles: ["hq"],
  },
  {
    alias: "demo-manager-a",
    name: "中山店店長",
    branches: ["中山店"],
    headquarters: false,
    roles: ["store-manager"],
  },
  {
    alias: "demo-clerk-a",
    name: "中山店店員",
    branches: ["中山店"],
    headquarters: false,
    roles: ["clerk"],
  },
  {
    alias: "demo-manager-b",
    name: "信義店店長",
    branches: ["信義店"],
    headquarters: false,
    roles: ["store-manager"],
  },
  {
    alias: "demo-clerk-b",
    name: "信義店店員",
    branches: ["信義店"],
    headquarters: false,
    roles: ["clerk"],
  },
];
