import type { OnboardingStep } from "../onboarding/context";
import type { OnboardingClassBDealer } from "../onboarding/plan";
import { tenantDayInstants } from "../onboarding/tenant-dates";

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

/** 一位示範受託人(關係人,規格 5.3;`createLotteryDealerContact` 的 input)。 */
export interface DemoTrustee {
  /** 重跑時以姓名找回(同名的受託人已存在就不動)。 */
  name: string;
  nationalId: string;
  mobile: string;
}

export const DEMO_TRUSTEES: readonly DemoTrustee[] = [
  { name: "王受託", nationalId: "Z900000021", mobile: "0912000021" },
];

/** 一家示範甲類(規格 5.2;進貨單要選甲類,受託人批購要選受託人)。 */
export interface DemoClassADealer {
  /** 證號 8 碼數字(重跑時以它找回,已存在就不動) */
  licenseNo: string;
  name: string;
  nationalId: string;
  licenseApprovedOn: string;
  licenseExpiresOn: string;
  /** 最近一次批購基準日 / 最近一次本人批購基準日(開通清單第 10 點;`YYYY-MM-DD`) */
  lastPurchaseBaseOn: string;
  lastSelfPurchaseBaseOn: string;
  /** 共同銷售處所:乙類的證號(須在 `DEMO_CLASS_B_DEALERS` 內) */
  coSalesLicenseNo: string;
  /** 受託人姓名(須在 `DEMO_TRUSTEES` 內) */
  trustees: readonly string[];
}

/** 兩個批購基準日都超過 180 天(驗收「經銷商管理」側欄數字);證號、身分證字號是虛構的示範值。 */
export const DEMO_CLASS_A_DEALERS: readonly DemoClassADealer[] = [
  {
    licenseNo: "90000011",
    name: "示範甲類一",
    nationalId: "Z900000011",
    licenseApprovedOn: "2025-01-02",
    licenseExpiresOn: "2028-12-31",
    lastPurchaseBaseOn: "2026-03-01",
    lastSelfPurchaseBaseOn: "2026-03-01",
    coSalesLicenseNo: "90000001",
    trustees: ["王受託"],
  },
];

const CONTACTS = /* GraphQL */ `
  query DemoDealerContacts($input: LotteryDealerContactsInput!) {
    lotteryDealerContacts(input: $input) {
      items {
        id
        name
      }
    }
  }
`;

const CREATE_CONTACT = /* GraphQL */ `
  mutation DemoCreateDealerContact($input: CreateLotteryDealerContactInput!) {
    createLotteryDealerContact(input: $input) {
      item {
        id
      }
    }
  }
`;

const DEALERS = /* GraphQL */ `
  query DemoDealers($input: LotteryDealersInput!) {
    lotteryDealers(input: $input) {
      items {
        id
        licenseNo
      }
    }
  }
`;

const CREATE_DEALER = /* GraphQL */ `
  mutation DemoCreateClassADealer($input: CreateLotteryDealerInput!) {
    createLotteryDealer(input: $input) {
      item {
        id
      }
    }
  }
`;

type Client = Parameters<OnboardingStep["run"]>[0]["client"];

/** 以證號找經銷商 id(找不到為 null)。 */
async function dealerIdOf(
  client: Client,
  type: "A" | "B",
  licenseNo: string,
): Promise<string | null> {
  const { lotteryDealers } = await client.request<{
    lotteryDealers: { items: { id: string; licenseNo: string }[] };
  }>(DEALERS, { input: { type, keyword: licenseNo, pageSize: 100 } });
  return (
    lotteryDealers.items.find((item) => item.licenseNo === licenseNo)?.id ??
    null
  );
}

/** 以姓名找受託人;沒有就建立。回傳 id 與結果行。 */
async function ensureTrustee(
  client: Client,
  trustee: DemoTrustee,
): Promise<{ id: string; line: string }> {
  const { lotteryDealerContacts } = await client.request<{
    lotteryDealerContacts: { items: { id: string; name: string }[] };
  }>(CONTACTS, {
    input: { keyword: trustee.name, role: "TRUSTEE", pageSize: 100 },
  });
  const existing = lotteryDealerContacts.items.find(
    (item) => item.name === trustee.name,
  );
  if (existing !== undefined) {
    return { id: existing.id, line: `受託人「${trustee.name}」已存在` };
  }
  const { createLotteryDealerContact } = await client.request<{
    createLotteryDealerContact: { item: { id: string } };
  }>(CREATE_CONTACT, {
    input: {
      name: trustee.name,
      roles: ["TRUSTEE"],
      nationalId: trustee.nationalId,
      mobile: trustee.mobile,
      status: "ACTIVE",
    },
  });
  return {
    id: createLotteryDealerContact.item.id,
    line: `建立受託人「${trustee.name}」`,
  };
}

/** 受託人姓名 → id(示範資料寫錯時是程式錯誤)。 */
function trusteeIdsOf(
  names: readonly string[],
  ids: ReadonlyMap<string, string>,
): string[] {
  return names.map((name) => {
    const id = ids.get(name);
    if (id === undefined) {
      throw new Error(`受託人「${name}」不在示範受託人清單裡`);
    }
    return id;
  });
}

/**
 * **示範資料專用**的一步:受託人與甲類(含兩個批購基準日、共同銷售處所、受託人)。甲類與關係人不在開通清單裡
 * (真實租戶由總部在經銷商管理建或匯入;兩個批購基準日是開通清單第 10 點的人工步驟),所以不放進
 * `onboarding/steps.ts`,只由示範指令接在開通步驟(乙類)後面跑。受託人以姓名、甲類以證號找回,
 * 已存在就不改;只用經銷商管理既有的 GraphQL。
 */
export const demoDealersStep: OnboardingStep = {
  key: "demo-dealers",
  title: "示範受託人與甲類",
  run: async ({ client }) => {
    const lines: string[] = [];
    const trusteeIds = new Map<string, string>();
    for (const trustee of DEMO_TRUSTEES) {
      const { id, line } = await ensureTrustee(client, trustee);
      trusteeIds.set(trustee.name, id);
      lines.push(line);
    }
    const instantOf = await tenantDayInstants(client);
    for (const dealer of DEMO_CLASS_A_DEALERS) {
      if ((await dealerIdOf(client, "A", dealer.licenseNo)) !== null) {
        lines.push(`甲類「${dealer.name}」已存在`);
        continue;
      }
      const coSalesDealerId = await dealerIdOf(
        client,
        "B",
        dealer.coSalesLicenseNo,
      );
      if (coSalesDealerId === null) {
        throw new Error(
          `找不到共同銷售處所(乙類證號 ${dealer.coSalesLicenseNo}):「乙類與對應分店」那一步要排在前面`,
        );
      }
      await client.request(CREATE_DEALER, {
        input: {
          type: "A",
          licenseNo: dealer.licenseNo,
          name: dealer.name,
          nationalId: dealer.nationalId,
          status: "ACTIVE",
          licenseApprovedAt: instantOf(dealer.licenseApprovedOn),
          licenseExpiresAt: instantOf(dealer.licenseExpiresOn),
          lastPurchaseBaseDate: instantOf(dealer.lastPurchaseBaseOn),
          lastSelfPurchaseBaseDate: instantOf(dealer.lastSelfPurchaseBaseOn),
          coSalesDealerId,
          trusteeIds: trusteeIdsOf(dealer.trustees, trusteeIds),
        },
      });
      lines.push(
        `建立甲類「${dealer.name}」:共同銷售處所 乙類 ${dealer.coSalesLicenseNo}、受託人 ${dealer.trustees.join("、")}`,
      );
    }
    return lines;
  },
};
