import { type OnboardingStep, requireTenant } from "../context";

const ORG_TREE = /* GraphQL */ `
  query OnboardingOrgTree {
    orgTree {
      id
      children {
        id
        name
      }
    }
  }
`;

const CREATE_CHILD_ORG = /* GraphQL */ `
  mutation OnboardingCreateBranch($input: CreateChildOrgInput!) {
    createChildOrg(input: $input) {
      org {
        id
        name
      }
    }
  }
`;

interface TreeData {
  orgTree: { id: string; children: { id: string; name: string }[] }[];
}

/** 分店 = 租戶頂層的直接下層組織;已有同名的就沿用(重跑不重建)。 */
export const branchesStep: OnboardingStep = {
  key: "branches",
  title: "分店",
  run: async ({ client, plan, state }) => {
    const tenant = requireTenant(state);
    const { orgTree } = await client.request<TreeData>(ORG_TREE);
    const top = orgTree.find((node) => node.id === tenant.id);
    if (top === undefined) {
      throw new Error("組織樹裡找不到租戶頂層");
    }
    const existing = new Map(
      top.children.map((child) => [child.name, child.id]),
    );
    const lines: string[] = [];
    for (const { name } of plan.branches) {
      const found = existing.get(name);
      if (found !== undefined) {
        state.branchIds.set(name, found);
        lines.push(`「${name}」已存在`);
        continue;
      }
      const { createChildOrg } = await client.request<{
        createChildOrg: { org: { id: string } };
      }>(CREATE_CHILD_ORG, { input: { parentId: tenant.id, name } });
      state.branchIds.set(name, createChildOrg.org.id);
      lines.push(`建立「${name}」`);
    }
    return lines.length === 0 ? ["沒有要建立的分店"] : lines;
  },
};
