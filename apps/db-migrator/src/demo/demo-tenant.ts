/**
 * 示範機構的建立 / 找回(demo `create` 的第一段,以平台管理員 root 呼叫 api)。
 *
 * 以**租戶短碼(slug,全域唯一)+「示範」標記**找回,不靠名稱:
 * - 根組織底下沒有這個短碼的租戶 → `provisionTenant`(`demo: true`):建立標「示範」的機構與首任租戶管理員
 *   `<基底>+<adminAlias>@…`(密碼 = 示範密碼,只存雜湊;不寄啟用信、首登不強改)。開放的模組 = 開通時可選的全部
 * - 有這個短碼、而且標「示範」 → 沿用,什麼都不改(首任管理員的密碼若已被改過,下一步登入會失敗並停下)
 * - 有這個短碼、卻沒有「示範」標記 → 拒絕,一筆都不寫(真實租戶永遠不被當成示範機構)
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

/** 一次讀所有租戶頂層的短碼與標記(以別名把多個 `org(id)` 放進同一個請求)。 */
function tenantsQuery(ids: readonly string[]): string {
  const fields = ids
    .map(
      (id, index) =>
        `t${String(index)}: org(id: ${JSON.stringify(id)}) { id slug isDemo }`,
    )
    .join(" ");
  return `query DemoTenants { ${fields} }`;
}

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

interface TenantRow {
  id: string;
  slug: string | null;
  isDemo: boolean;
}

/** 根組織底下短碼相同的租戶頂層(找不到為 null)。 */
async function findTenantBySlug(
  root: GraphqlClient,
  slug: string,
): Promise<TenantRow | null> {
  const data = await root.request<{ orgTree: TreeNode[] }>(ROOT_TENANTS);
  const rootOrg = data.orgTree.find((node) => node.parentId === null);
  if (rootOrg === undefined) {
    throw new Error(
      "以 root 登入卻讀不到根組織:確認 ROOT_ADMIN_ACCOUNT 是平台管理員",
    );
  }
  const ids = rootOrg.children.map((child) => child.id);
  if (ids.length === 0) {
    return null;
  }
  const tenants = await root.request<Record<string, TenantRow>>(
    tenantsQuery(ids),
  );
  return Object.values(tenants).find((tenant) => tenant.slug === slug) ?? null;
}

export async function ensureDemoTenant(
  root: GraphqlClient,
  tenant: DemoTenant,
  secrets: { emailBase: string; password: string },
  print: (line: string) => void,
): Promise<DemoTenantResult> {
  const adminAccount = aliasEmail(secrets.emailBase, tenant.adminAlias);
  const existing = await findTenantBySlug(root, tenant.slug);
  if (existing !== null) {
    if (!existing.isDemo) {
      throw new Error(
        `短碼 ${tenant.slug} 的機構沒有「示範」標記,不是示範機構:拒絕執行,一筆都沒有寫入`,
      );
    }
    print(`示範機構「${tenant.name}」已存在,沿用`);
    return { orgId: existing.id, adminAccount, created: false };
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
