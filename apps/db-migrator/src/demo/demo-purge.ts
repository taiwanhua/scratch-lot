/**
 * 清空示範機構(demo `purge`,`rebuild` 的第一段;以平台管理員 root 呼叫 api 的 `purgeDemoTenant`)。
 *
 * 以專案示範資料固定的**租戶短碼**找機構,api 端再擋「示範」標記:
 * - 沒有這個短碼的租戶 → 什麼都不做(`purged: false`)
 * - 有、而且標「示範」 → 刪掉它的全部資料(含只能新增的帳本)、只屬於它的使用者與它引用的檔案;
 *   也屬於其他機構的使用者只移除在示範機構的所屬
 * - 有、卻沒有「示範」標記 → api 回 `FORBIDDEN`,一筆都不刪(真實租戶永遠不被當成示範機構清掉)
 *
 * 刪除範圍由 api 的登記決定(`apps/api/src/database/tenant-purge.ts`),本檔只負責呼叫與輸出。
 */
import type { DemoTenant } from "./demo-source";
import { type GraphqlClient, GraphqlRequestError } from "./graphql-client";

const PURGE = /* GraphQL */ `
  mutation DemoPurgeTenant($input: PurgeDemoTenantInput!) {
    purgeDemoTenant(input: $input) {
      purged
      deletedDocuments
      deletedUsers
      detachedUsers
      deletedFiles
      collections {
        collection
        deleted
      }
    }
  }
`;

interface PurgeResult {
  purged: boolean;
  deletedDocuments: number;
  deletedUsers: number;
  detachedUsers: number;
  deletedFiles: number;
  collections: { collection: string; deleted: number }[];
}

/** 清空示範機構;回 true = 有清到一個機構。 */
export async function purgeDemoTenant(
  root: GraphqlClient,
  tenant: DemoTenant,
  print: (line: string) => void,
): Promise<boolean> {
  const { purgeDemoTenant: result } = await root
    .request<{ purgeDemoTenant: PurgeResult }>(PURGE, {
      input: { slug: tenant.slug },
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        // 看錯誤碼、不比對訊息:FORBIDDEN = 對到的機構沒有「示範」標記,或操作者不是持權限的根組織平台管理員
        error instanceof GraphqlRequestError && error.code === "FORBIDDEN"
          ? `api 拒絕清空短碼 ${tenant.slug} 的機構(FORBIDDEN):它沒有「示範」標記(不是示範機構),或 ROOT_ADMIN_ACCOUNT 不是持 tenant-ops.purge-demo 的根組織平台管理員;一筆都沒有刪除(api:${message})`
          : `清空示範機構失敗(api 端刪除與稽核是同一個交易,失敗就整批回復):${message}`,
        { cause: error },
      );
    });
  if (!result.purged) {
    print(`沒有短碼 ${tenant.slug} 的示範機構「${tenant.name}」,不用清空`);
    return false;
  }
  print(
    `已清空示範機構「${tenant.name}」:刪除 ${String(result.deletedDocuments)} 筆資料、${String(result.deletedUsers)} 位只屬於它的使用者、${String(result.deletedFiles)} 個檔案;${String(result.detachedUsers)} 位也屬於其他機構的使用者只移除所屬`,
  );
  for (const entry of result.collections) {
    print(`  ${entry.collection}:${String(entry.deleted)}`);
  }
  return true;
}
