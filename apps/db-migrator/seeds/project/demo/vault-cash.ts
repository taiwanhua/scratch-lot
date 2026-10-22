import {
  CASH_CORRECTION_DIRECTION,
  CASH_CORRECTION_FORM_KEY,
  CASH_CORRECTION_PLACE,
  CASH_CORRECTION_FIELD_KEYS as KEYS,
} from "@repo/domain/project/lottery";
import { REASON_OTHER_VALUE } from "@repo/domain/project/reason-note";

import { type OnboardingStep, requireBranchId } from "../onboarding/context";

/** 一家分店小金庫的起始現金(用現金更正單登記,規格 6.7「請先用現金更正單登記小金庫實際的錢」)。 */
export interface DemoVaultCash {
  branch: string;
  amount: number;
  note: string;
}

/**
 * 示範的小金庫起始現金:中山店 20,000(驗收流程的開班零用金、投庫 / 出庫、調貨付現、日結都從它算);
 * 信義店不登記(驗收流程假設信義店小金庫是 0)。
 */
export const DEMO_VAULT_CASH: readonly DemoVaultCash[] = [
  { branch: "中山店", amount: 20_000, note: "上線前小金庫既有現金" },
];

const CASH_CORRECTIONS = /* GraphQL */ `
  query DemoCashCorrections($orgId: ID!) {
    lotteryStoreCashCorrections(orgId: $orgId) {
      items {
        id
        status
        direction
        place
      }
    }
  }
`;

const SUBMIT = /* GraphQL */ `
  mutation DemoSubmitCashCorrection(
    $input: CreateAndSubmitFormSubmissionInput!
  ) {
    createAndSubmitFormSubmission(input: $input) {
      submission {
        id
        status
        serialNo
      }
    }
  }
`;

/** 已經登記過(沒被作廢、駁回)的小金庫增加:重跑不再送一張。 */
const SETTLED_ELSEWHERE = new Set(["VOIDED", "REJECTED"]);

/**
 * **示範資料專用**的一步:各分店小金庫的起始現金。真實租戶由店長在店面管理自己送現金更正單,所以不放進
 * `onboarding/steps.ts`。這裡走同一張表單(位置 = 小金庫、方向 = 增加),由租戶管理員送出:
 * 流程照開通時綁的「店長限定分店」,**要那家店的店長在申請中心核准**後才寫進小金庫(示範帳號首登要改密碼,
 * 指令不能代替店長登入核准)。所以這一步要排在「流程」之後(否則表單沒綁流程,送出就直接完成)。
 * 那家店已經有一張小金庫增加的現金更正單(沒被作廢或駁回)就不再送。
 */
export const demoVaultCashStep: OnboardingStep = {
  key: "demo-vault-cash",
  title: "示範小金庫起始現金",
  run: async ({ client, state }) => {
    const lines: string[] = [];
    for (const vault of DEMO_VAULT_CASH) {
      const orgId = requireBranchId(state, vault.branch);
      const { lotteryStoreCashCorrections } = await client.request<{
        lotteryStoreCashCorrections: {
          items: { status: string; direction: string; place: string }[];
        };
      }>(CASH_CORRECTIONS, { orgId });
      if (
        lotteryStoreCashCorrections.items.some(
          (row) =>
            row.place === CASH_CORRECTION_PLACE.vault &&
            row.direction === CASH_CORRECTION_DIRECTION.increase &&
            !SETTLED_ELSEWHERE.has(row.status),
        )
      ) {
        lines.push(`「${vault.branch}」已登記過小金庫起始現金`);
        continue;
      }
      const { createAndSubmitFormSubmission } = await client.request<{
        createAndSubmitFormSubmission: {
          submission: { status: string; serialNo: string | null };
        };
      }>(SUBMIT, {
        input: {
          formKey: CASH_CORRECTION_FORM_KEY,
          // 前一次被駁回 / 作廢後重跑要換一個 id(同建立者 + 同 id 會回原本那一筆,不會另送一張);
          // 這家店的現金更正單筆數只增不減,當流水用
          clientRequestId: `demo-vault-cash-${orgId}-${String(lotteryStoreCashCorrections.items.length)}`,
          values: {
            [KEYS.branch]: orgId,
            [KEYS.direction]: CASH_CORRECTION_DIRECTION.increase,
            [KEYS.amount]: vault.amount,
            [KEYS.place]: CASH_CORRECTION_PLACE.vault,
            [KEYS.reason]: REASON_OTHER_VALUE,
            [KEYS.note]: vault.note,
          },
          touched: Object.values(KEYS),
        },
      });
      const { status, serialNo } = createAndSubmitFormSubmission.submission;
      const amount = vault.amount.toLocaleString("en-US");
      lines.push(
        status === "COMPLETED"
          ? `「${vault.branch}」小金庫起始現金 ${amount}:現金更正單 ${serialNo ?? ""} 已完成`
          : `「${vault.branch}」小金庫起始現金 ${amount}:現金更正單 ${serialNo ?? ""} 已送出,請${vault.branch}店長到申請中心核准(核准後才寫進小金庫)`,
      );
    }
    return lines;
  },
};
