import { type OnboardingStep, requireBranchId } from "../context";

const CASH_POINTS = /* GraphQL */ `
  query OnboardingLotteryCashPoints($input: LotteryCashPointsInput!) {
    lotteryCashPoints(input: $input) {
      items {
        id
        positionKey
      }
    }
  }
`;

const CREATE_CASH_POINT = /* GraphQL */ `
  mutation OnboardingCreateLotteryCashPoint(
    $input: CreateLotteryCashPointInput!
  ) {
    createLotteryCashPoint(input: $input) {
      item {
        id
      }
    }
  }
`;

/**
 * 收銀點(檔案管理,規格 5.5):要排在「分店」「崗位」之後;以「分店 + 崗位」找回,已存在就不改。
 * 印表機不設(用分店預設;店家裝好收據機後自己選)。
 */
export const cashPointsStep: OnboardingStep = {
  key: "cash-points",
  title: "收銀點",
  run: async ({ client, plan, state }) => {
    if (plan.cashPoints.length === 0) {
      return ["沒有要建立的收銀點"];
    }
    const lines: string[] = [];
    for (const point of plan.cashPoints) {
      const orgId = requireBranchId(state, point.branch);
      const { lotteryCashPoints } = await client.request<{
        lotteryCashPoints: { items: { id: string; positionKey: string }[] };
      }>(CASH_POINTS, { input: { orgId, pageSize: 100 } });
      const label = `${point.branch}「${point.name}」`;
      if (
        lotteryCashPoints.items.some(
          (item) => item.positionKey === point.positionKey,
        )
      ) {
        lines.push(`${label}已存在`);
        continue;
      }
      await client.request(CREATE_CASH_POINT, {
        input: {
          orgId,
          positionKey: point.positionKey,
          name: point.name,
          order: point.order,
        },
      });
      lines.push(`建立${label}`);
    }
    return lines;
  },
};
