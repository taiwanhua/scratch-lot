import type { OnboardingStep } from "../context";

const TENANT_SLUG = /* GraphQL */ `
  query OnboardingTenantSlug($id: ID!) {
    org(id: $id) {
      slug
    }
  }
`;

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

/**
 * 讀出登入者所屬的租戶(之後每一步都在這個租戶裡做)。站在根組織 = 不是租戶管理員,停下;
 * 租戶短碼和要開通的(`--tenant`)不同 → 停下,一筆都不寫。
 */
export const tenantStep: OnboardingStep = {
  key: "tenant",
  title: "租戶",
  run: async ({ client, state, tenantSlug }) => {
    const { me } = await client.request<MeData>(ME);
    const tenantId = me.currentOrg?.tenantId ?? null;
    if (me.currentOrg === null || tenantId === null) {
      throw new Error(
        "登入者不在任何租戶裡:開通腳本要用該租戶的租戶管理員登入,不是平台管理員",
      );
    }
    const { org } = await client.request<{ org: { slug: string | null } }>(
      TENANT_SLUG,
      { id: tenantId },
    );
    if (org.slug !== tenantSlug) {
      throw new Error(
        `登入者所屬的租戶「${me.currentOrg.tenantName}」(短碼 ${org.slug ?? "沒有"})不是要開通的 ${tenantSlug}:換成該租戶的租戶管理員登入`,
      );
    }
    state.tenant = { id: tenantId, name: me.currentOrg.tenantName };
    return [`租戶「${me.currentOrg.tenantName}」`];
  },
};
