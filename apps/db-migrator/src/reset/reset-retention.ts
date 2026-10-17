/**
 * `data` 模式的受管定義保留閉包(`docs/concepts/data-layer-and-isolation.md`「還原」)。
 *
 * 受管範圍的真相是**目前的 registry**:它登記的共用表單 / 流程,連同已發布、已退役的歷史版本、
 * 這些版本用到的動態(欄位級)權限、以及仍對得上實體的安裝紀錄,整組一起留(`_id`、版號、`retiredAt` 都不動)。
 * 其餘一律不在閉包裡:設計中的草稿(含受管定義的現場草稿)、畫面上自建而未登記的定義、
 * 租戶的客製 / fork、已不在 registry 的定義,以及它們的權限與安裝紀錄。
 *
 * 一致性:不會留下身分卻清空它的版本(沒有任何可保留版本的身分不留,由這次的 update 重新建立);
 * 不會清掉定義卻留下成功的安裝紀錄(安裝紀錄對不上保留的身分與版本就不留,update 不會因此略過)。
 *
 * 只讀資料庫,不寫入;collection 與欄位的形狀正本是 api 的 schema
 * (`apps/api/src/database/schemas/{form,form-version,workflow,workflow-version,permission,seed-definition-installation}.schema.ts`)。
 */
import type { Db, ObjectId } from "mongodb";

import {
  type DefinitionSeedKind,
  type DefinitionSeedSet,
  SEED_DEFINITION_INSTALLATIONS_COLLECTION,
} from "@repo/domain/seed";

/** 一種定義的身分表、版本表,與版本表指回身分的欄位。 */
export interface DefinitionStore {
  identities: string;
  versions: string;
  keyField: string;
}

export const DEFINITION_STORES: Readonly<
  Record<DefinitionSeedKind, DefinitionStore>
> = {
  "form-definition": {
    identities: "forms",
    versions: "form_versions",
    keyField: "formKey",
  },
  "workflow-definition": {
    identities: "workflows",
    versions: "workflow_versions",
    keyField: "workflowKey",
  },
};

export const PERMISSIONS_COLLECTION = "permissions";

/** 凍結的歷史版本;`draft` 不留(`publishing` 只存在於發布的交易內,交易外看不到)。 */
const HISTORY_STATUSES = ["published", "retired"];

/** api 安裝紀錄的完成狀態(另一個值 `in-progress` 在預檢就整次拒絕)。 */
const INSTALLATION_INSTALLED = "installed";

/** 欄位級權限的兩種動作:key 是 `<moduleKey>.<動作>-<formKey>-<fieldKey>`(formKey 不含 `-`,前綴不會誤中別張表單)。 */
const FIELD_PERMISSION_ACTIONS = ["show", "edit"];

interface IdentityDocument {
  _id: ObjectId;
  key: string;
  moduleKey?: string;
}

interface VersionDocument {
  _id: ObjectId;
  version: number | null;
}

interface InstallationDocument {
  _id: ObjectId;
  key: string;
  definitionId: ObjectId;
  localVersion: number | null;
}

interface PermissionDocument {
  _id: ObjectId;
  key: string;
}

export interface DefinitionRetention {
  /** collection → 要留的 `_id`;六張表都會列出(沒有可留的就是空陣列 = 整表清掉)。 */
  retained: Map<string, ObjectId[]>;
  /** 給操作者看的保留清單(不含機密)。 */
  summary: string[];
}

function keep(
  retained: Map<string, ObjectId[]>,
  collection: string,
  ids: readonly ObjectId[],
): void {
  retained.set(collection, [...(retained.get(collection) ?? []), ...ids]);
}

/** 一張保留的表單用到的動態權限(含已退役的;`_id` 與 `retiredAt` 原樣保留)。 */
function fieldPermissionsOf(
  identity: IdentityDocument,
  dynamicPermissions: readonly PermissionDocument[],
): PermissionDocument[] {
  const { moduleKey } = identity;
  if (moduleKey === undefined) {
    return [];
  }
  const prefixes = FIELD_PERMISSION_ACTIONS.map(
    (action) => `${moduleKey}.${action}-${identity.key}-`,
  );
  return dynamicPermissions.filter(({ key }) =>
    prefixes.some((prefix) => key.startsWith(prefix)),
  );
}

/**
 * 依目前 registry 登記的定義與資料庫現況,算出 `data` 模式要保留的閉包(唯讀)。
 */
export async function planDefinitionRetention(
  database: Db,
  definitions: readonly DefinitionSeedSet[],
): Promise<DefinitionRetention> {
  const retained = new Map<string, ObjectId[]>();
  const summary: string[] = [];
  const dynamicPermissions = await database
    .collection(PERMISSIONS_COLLECTION)
    .find<PermissionDocument>(
      { source: "dynamic" },
      { projection: { _id: 1, key: 1 } },
    )
    .toArray();

  keep(retained, PERMISSIONS_COLLECTION, []);
  keep(retained, SEED_DEFINITION_INSTALLATIONS_COLLECTION, []);
  for (const [kind, store] of Object.entries(DEFINITION_STORES)) {
    keep(retained, store.identities, []);
    keep(retained, store.versions, []);
    const keys = [
      ...new Set(
        definitions.filter((seed) => seed.kind === kind).map(({ key }) => key),
      ),
    ];
    // 只有共用定義會被納管;同 key 的租戶客製不算(流程另以 tenantId 為邊界)
    const identities = await database
      .collection(store.identities)
      .find<IdentityDocument>(
        { key: { $in: keys }, ownerOrgId: null, tenantId: null },
        { projection: { _id: 1, key: 1, moduleKey: 1 } },
      )
      .sort({ key: 1 })
      .toArray();
    for (const identity of identities) {
      const versions = await database
        .collection(store.versions)
        .find<VersionDocument>(
          {
            [store.keyField]: identity.key,
            status: { $in: HISTORY_STATUSES },
          },
          { projection: { _id: 1, version: 1 } },
        )
        .sort({ version: 1 })
        .toArray();
      if (versions.length === 0) {
        continue;
      }
      const numbers = versions.map(({ version }) => version);
      const installations = await database
        .collection(SEED_DEFINITION_INSTALLATIONS_COLLECTION)
        .find<InstallationDocument>(
          { kind, key: identity.key, status: INSTALLATION_INSTALLED },
          { projection: { _id: 1, key: 1, definitionId: 1, localVersion: 1 } },
        )
        .toArray();
      const validInstallations = installations.filter(
        ({ definitionId, localVersion }) =>
          definitionId.equals(identity._id) && numbers.includes(localVersion),
      );
      const permissions = fieldPermissionsOf(identity, dynamicPermissions);
      keep(retained, store.identities, [identity._id]);
      keep(
        retained,
        store.versions,
        versions.map(({ _id }) => _id),
      );
      keep(
        retained,
        SEED_DEFINITION_INSTALLATIONS_COLLECTION,
        validInstallations.map(({ _id }) => _id),
      );
      keep(
        retained,
        PERMISSIONS_COLLECTION,
        permissions.map(({ _id }) => _id),
      );
      summary.push(
        `保留受管定義 ${kind}:${identity.key}(版本 ${numbers.join("、")};安裝紀錄 ${String(validInstallations.length)} 筆;動態權限 ${String(permissions.length)} 筆)`,
      );
    }
  }
  return { retained, summary };
}
