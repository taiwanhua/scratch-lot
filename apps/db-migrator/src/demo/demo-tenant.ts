/**
 * 示範機構的建立 / 找回(demo `create` 的第一段,以平台管理員 root 呼叫 api)。
 *
 * - 根組織底下沒有同名的租戶 → `provisionTenant`(`demo: true`):建立標「示範」的機構與首任租戶管理員
 *   `<基底>+<adminAlias>@…`(密碼 = 示範密碼,只存雜湊;不寄啟用信、首登不強改)。開放的模組 = 開通時可選的全部
 * - 已有同名且標「示範」的機構 → 沿用,什麼都不改(首任管理員的密碼若已被改過,下一步登入會失敗並停下)
 * - 同名的機構沒有「示範」標記 → 拒絕,一筆都不寫(真實租戶永遠不被當成示範機構)
 */
import { type DemoTenant, aliasEmail } from "./demo-source";
import type { GraphqlClient } from "./graphql-client";

const ROOT_TENANTS = /* GraphQL */ `
  query DemoRootTenants {
    orgTree {
      id
      parentId
      children {
        id
        name
      }
    }
  }
`;

const ORG = /* GraphQL */ `
  query DemoOrg($id: ID!) {
    org(id: $id) {
      id
      name
      isDemo
    }
  }
`;

const TENANT_MODULE_OPTIONS = /* GraphQL */ `
  query DemoTenantModuleOptions {
    tenantModuleOptions {
      key
    }
  }
`;

const PROVISION = /* GraphQL */ `
  mutation DemoProvisionTenant($input: ProvisionTenantInput!) {
    provisionTenant(input: $input) {
      org {
        id
        isDemo
      }
    }
  }
`;

interface TreeNode {
  id: string;
  parentId: string | null;
  children: { id: string; name: string }[];
}

export interface DemoTenantResult {
  orgId: string;
  adminAccount: string;
  created: boolean;
}

/** 根組織底下名稱相同的租戶頂層(找不到為 null)。 */
async function findTenantByName(
  root: GraphqlClient,
  name: string,
): Promise<string | null> {
  const data = await root.request<{ orgTree: TreeNode[] }>(ROOT_TENANTS);
  const rootOrg = data.orgTree.find((node) => node.parentId === null);
  if (rootOrg === undefined) {
    throw new Error(
      "以 root 登入卻讀不到根組織:確認 ROOT_ADMIN_ACCOUNT 是平台管理員",
    );
  }
  const matches = rootOrg.children.filter((child) => child.name === name);
  if (matches.length > 1) {
    throw new Error(
      `根組織底下有 ${String(matches.length)} 個名為「${name}」的機構,無法判斷是哪一個`,
    );
  }
  return matches[0]?.id ?? null;
}

export async function ensureDemoTenant(
  root: GraphqlClient,
  tenant: DemoTenant,
  secrets: { emailBase: string; password: string },
  print: (line: string) => void,
): Promise<DemoTenantResult> {
  const adminAccount = aliasEmail(secrets.emailBase, tenant.adminAlias);
  const existingId = await findTenantByName(root, tenant.name);
  if (existingId !== null) {
    const { org } = await root.request<{
      org: { id: string; isDemo: boolean };
    }>(ORG, { id: existingId });
    if (!org.isDemo) {
      throw new Error(
        `根組織底下的「${tenant.name}」沒有「示範」標記,不是示範機構:拒絕執行,一筆都沒有寫入`,
      );
    }
    print(`示範機構「${tenant.name}」已存在,沿用`);
    return { orgId: org.id, adminAccount, created: false };
  }

  const { tenantModuleOptions } = await root.request<{
    tenantModuleOptions: { key: string }[];
  }>(TENANT_MODULE_OPTIONS);
  const { provisionTenant } = await root.request<{
    provisionTenant: { org: { id: string; isDemo: boolean } };
  }>(PROVISION, {
    input: {
      name: tenant.name,
      slug: tenant.slug,
      adminAccount,
      adminEmail: adminAccount,
      moduleKeys: tenantModuleOptions.map((option) => option.key),
      demo: true,
      adminInitialPassword: secrets.password,
    },
  });
  // 信箱是真實信箱的別名,不印出來(workflow 的遮罩只遮基底本身)
  print(
    `已建立示範機構「${tenant.name}」與首任租戶管理員(+${tenant.adminAlias})`,
  );
  return { orgId: provisionTenant.org.id, adminAccount, created: true };
}
