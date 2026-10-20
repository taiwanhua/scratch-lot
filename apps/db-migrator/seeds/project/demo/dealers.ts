import type { OnboardingClassBDealer } from "../onboarding/plan";

/**
 * 示範機構的乙類(經銷商管理;規格 5.2):兩家店各對應一家分店。
 * 證號、身分證字號是虛構的示範值(格式合法),不是真實資料。
 */
export const DEMO_CLASS_B_DEALERS: readonly OnboardingClassBDealer[] = [
  {
    licenseNo: "90000001",
    name: "示範乙類一",
    nationalId: "Z900000001",
    licenseApprovedOn: "2025-01-02",
    licenseExpiresOn: "2027-12-31",
    storeName: "示範彩券 中山店",
    branch: "中山店",
  },
  {
    licenseNo: "90000002",
    name: "示範乙類二",
    nationalId: "Z900000002",
    licenseApprovedOn: "2025-01-02",
    licenseExpiresOn: "2027-12-31",
    storeName: "示範彩券 信義店",
    branch: "信義店",
  },
];
