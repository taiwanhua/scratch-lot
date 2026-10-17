/**
 * 底座把表單 / 流程的發布與退役改成交易(ADR-0013)**之前**留下的中斷資料(唯讀檢查)。
 *
 * 交易化之後,交易外永遠看不到發布或退役做到一半的版本,api 也拿掉了「重試發布」;但引用專案升級時不清庫,
 * 舊版留下的中斷資料還在,而且救不回來:
 * - 有 `publishing` 版本 → 下一次發布撞 `*_publishing_unique` 部分唯一索引,永遠回 `DRAFT_REVISION_MISMATCH`
 * - `published` 卻不是 `currentVersion`、或 `currentVersion` 指到不是 `published` 的版本 →
 *   受管定義安裝把它當外部漂移(`CURRENT_VERSION_DRIFT`)
 *
 * 所以 `update` 與 `data` reset 的預檢都先查這三種狀態,有就整次拒絕;**不自動修資料**,
 * 每一筆附處理方式,照 `docs/deployment.md`「舊版留下的發布 / 退役中斷」以 mongosh 手動補完。
 */
import type { Db, ObjectId } from "mongodb";

import {
  DEFINITION_STORES,
  type DefinitionStore,
} from "../reset/reset-retention";

/** 手動處理的說明位置(blocker 訊息都指向這裡)。 */
export const INTERRUPTED_LIFECYCLE_GUIDE =
  "docs/deployment.md「舊版留下的發布 / 退役中斷」";

interface IdentityState {
  _id: ObjectId;
  key: string;
  currentVersion?: number | null;
}

interface VersionState {
  _id: ObjectId;
  version: number | null;
  status: string;
  [keyField: string]: unknown;
}

const LABELS: Readonly<Record<keyof typeof DEFINITION_STORES, string>> = {
  "form-definition": "表單",
  "workflow-definition": "流程",
};

/** 一種定義(表單 / 流程)裡所有舊版留下的中斷發布與退役;每筆附處理方式。 */
async function interruptedOf(
  database: Db,
  label: string,
  store: DefinitionStore,
): Promise<string[]> {
  const identities = await database
    .collection(store.identities)
    .find<IdentityState>(
      {},
      { projection: { _id: 1, key: 1, currentVersion: 1 } },
    )
    .sort({ key: 1 })
    .toArray();
  const versions = await database
    .collection(store.versions)
    .find<VersionState>(
      { status: { $in: ["publishing", "published"] } },
      { projection: { _id: 1, [store.keyField]: 1, version: 1, status: 1 } },
    )
    .sort({ [store.keyField]: 1, version: 1 })
    .toArray();
  const identityOf = new Map(identities.map((item) => [item.key, item]));
  const published = new Set<string>();
  const blockers: string[] = [];
  for (const record of versions) {
    const key = String(record[store.keyField]);
    const version = String(record.version);
    const where = `${store.versions} _id ${record._id.toHexString()}`;
    if (record.status === "publishing") {
      blockers.push(
        `${label} ${key} 的版本 ${version} 停在 publishing(舊版發布中斷;${where}):改回草稿再重新發布(${INTERRUPTED_LIFECYCLE_GUIDE} 第 1 種)`,
      );
      continue;
    }
    published.add(`${key}@${version}`);
    const identity = identityOf.get(key);
    const current = identity?.currentVersion ?? null;
    if (current !== record.version) {
      blockers.push(
        `${label} ${key} 的版本 ${version} 已是 published,但 currentVersion 是 ${String(current)}(舊版發布切換到一半;${where}、${store.identities} _id ${identity?._id.toHexString() ?? "?"}):補完切換(${INTERRUPTED_LIFECYCLE_GUIDE} 第 2 種)`,
      );
    }
  }
  for (const identity of identities) {
    const current = identity.currentVersion ?? null;
    if (
      current !== null &&
      !published.has(`${identity.key}@${String(current)}`)
    ) {
      blockers.push(
        `${label} ${identity.key} 的 currentVersion 指向版本 ${String(current)},但它不是 published(舊版退役做到一半;${store.identities} _id ${identity._id.toHexString()}):補完退役(${INTERRUPTED_LIFECYCLE_GUIDE} 第 3 種)`,
      );
    }
  }
  return blockers;
}

/** 表單與流程所有舊版留下的中斷發布 / 退役(唯讀;沒有就是空陣列)。 */
export async function findInterruptedLifecycles(
  database: Db,
): Promise<string[]> {
  const blockers: string[] = [];
  for (const [kind, store] of Object.entries(DEFINITION_STORES)) {
    blockers.push(
      ...(await interruptedOf(
        database,
        LABELS[kind as keyof typeof DEFINITION_STORES],
        store,
      )),
    );
  }
  return blockers;
}

/** `update` 預檢沒過:舊版留下的中斷發布 / 退役。此時還沒有執行任何 migration 或 seed。 */
export class InterruptedLifecycleError extends Error {
  override name = "InterruptedLifecycleError";

  constructor(readonly blockers: readonly string[]) {
    super(
      `update 預檢未通過(尚未執行任何 migration 或 seed):\n- ${blockers.join("\n- ")}\n底座的發布與退役已改成交易,這些是升級前舊版留下的中斷,api 不會再自動接續;請依 ${INTERRUPTED_LIFECYCLE_GUIDE} 手動補完後重跑。預檢不會自動修資料`,
    );
  }
}
