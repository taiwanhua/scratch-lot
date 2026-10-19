import { type OnboardingStep, requireTenant } from "../context";

const ORG = /* GraphQL */ `
  query OnboardingTenantVisibility($id: ID!) {
    org(id: $id) {
      id
      visibility
    }
  }
`;

const SET_VISIBILITY = /* GraphQL */ `
  mutation OnboardingSetVisibility($input: SetOrgVisibilityInput!) {
    setOrgVisibility(input: $input) {
      org {
        id
        visibility
      }
    }
  }
`;

/** 開通清單第 1 點:租戶的可見性開關設為「包含下層」(不改底座預設值,只改這個租戶)。 */
export const orgVisibilityStep: OnboardingStep = {
  key: "org-visibility",
  title: "組織可見性",
  run: async ({ client, state }) => {
    const tenant = requireTenant(state);
    const { org } = await client.request<{
      org: { visibility: string | null };
    }>(ORG, { id: tenant.id });
    if (org.visibility === "SUBTREE") {
      return ["已是「包含下層」"];
    }
    await client.request(SET_VISIBILITY, {
      input: { orgId: tenant.id, visibility: "SUBTREE" },
    });
    return ["設為「包含下層」"];
  },
};
