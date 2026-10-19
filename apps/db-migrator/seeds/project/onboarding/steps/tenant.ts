import type { OnboardingStep } from "../context";

const ME = /* GraphQL */ `
  query OnboardingMe {
    me {
      currentOrg {
        tenantId
        tenantName
      }
    }
  }
`;

interface MeData {
  me: { currentOrg: { tenantId: string | null; tenantName: string } | null };
}

/** 讀出登入者所屬的租戶(之後每一步都在這個租戶裡做);站在根組織 = 不是租戶管理員,停下。 */
export const tenantStep: OnboardingStep = {
  key: "tenant",
  title: "租戶",
  run: async ({ client, state }) => {
    const { me } = await client.request<MeData>(ME);
    const tenantId = me.currentOrg?.tenantId ?? null;
    if (me.currentOrg === null || tenantId === null) {
      throw new Error(
        "登入者不在任何租戶裡:開通腳本要用該租戶的租戶管理員登入,不是平台管理員",
      );
    }
    state.tenant = { id: tenantId, name: me.currentOrg.tenantName };
    return [`租戶「${me.currentOrg.tenantName}」`];
  },
};
