import {
  DEFAULT_TENANT_TIMEZONE,
  parseLocalDate,
  startOfLocalDay,
} from "@repo/domain/form";

import { type OnboardingStep, requireBranchId } from "../context";

const TIMEZONE = /* GraphQL */ `
  query OnboardingTimezone {
    me {
      currentOrg {
        timezone
      }
    }
  }
`;

const CLASS_B_DEALERS = /* GraphQL */ `
  query OnboardingClassBDealers($input: LotteryDealersInput!) {
    lotteryDealers(input: $input) {
      items {
        id
        licenseNo
      }
    }
  }
`;

const CREATE_DEALER = /* GraphQL */ `
  mutation OnboardingCreateClassBDealer($input: CreateLotteryDealerInput!) {
    createLotteryDealer(input: $input) {
      item {
        id
      }
    }
  }
`;

/**
 * 開通清單第 6 點的前半:乙類與對應分店(經銷商管理;規格 5.2、5.4)。
 * 開通資料列的乙類以證號找回,已存在就沿用(不改它的資料、不改對應分店);沒有就建立並對應分店。
 * 銀行帳戶與使用組織(後半)由帳戶管理追加自己的一步。
 */
export const classBDealersStep: OnboardingStep = {
  key: "class-b-dealers",
  title: "乙類與對應分店",
  run: async ({ client, plan, state }) => {
    const dealers = plan.classBDealers ?? [];
    if (dealers.length === 0) {
      return ["沒有要建立的乙類"];
    }
    const { me } = await client.request<{
      me: { currentOrg: { timezone: string } | null };
    }>(TIMEZONE);
    const timezone = me.currentOrg?.timezone ?? DEFAULT_TENANT_TIMEZONE;
    const instantOf = (text: string): string => {
      const date = parseLocalDate(text);
      if (date === null) {
        throw new Error(`日期不合法:${text}`);
      }
      return new Date(startOfLocalDay(date, timezone)).toISOString();
    };
    const lines: string[] = [];
    for (const dealer of dealers) {
      const { lotteryDealers } = await client.request<{
        lotteryDealers: { items: { id: string; licenseNo: string }[] };
      }>(CLASS_B_DEALERS, {
        input: { type: "B", keyword: dealer.licenseNo, pageSize: 100 },
      });
      if (
        lotteryDealers.items.some((item) => item.licenseNo === dealer.licenseNo)
      ) {
        lines.push(`乙類「${dealer.storeName ?? dealer.name}」已存在`);
        continue;
      }
      await client.request(CREATE_DEALER, {
        input: {
          type: "B",
          licenseNo: dealer.licenseNo,
          name: dealer.name,
          nationalId: dealer.nationalId,
          licenseApprovedAt: instantOf(dealer.licenseApprovedOn),
          licenseExpiresAt: instantOf(dealer.licenseExpiresOn),
          storeName: dealer.storeName,
          storeOrgId:
            dealer.branch === null
              ? null
              : requireBranchId(state, dealer.branch),
        },
      });
      const label = dealer.storeName ?? dealer.name;
      lines.push(
        dealer.branch === null
          ? `建立乙類「${label}」`
          : `建立乙類「${label}」,對應「${dealer.branch}」`,
      );
    }
    return lines;
  },
};
