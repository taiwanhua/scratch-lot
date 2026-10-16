import { createHash } from "node:crypto";

import { type Connection, Types } from "mongoose";

import type { FieldDef } from "@repo/domain/form";
import {
  DEFINITION_SEED_PROTOCOL_VERSION,
  type DefinitionSeedHashes,
  type DefinitionSeedItemResult,
  type DefinitionSeedOperation,
  type DefinitionSeedRequest,
  type DefinitionSeedResult,
  type DefinitionSeedSet,
  type FormDefinitionSeedSet,
  SEED_DEFINITION_INSTALLATIONS_COLLECTION,
  SEED_LOCK_COLLECTION,
  SEED_LOCK_ID,
  type SeedLockDocument,
  type WorkflowDefinitionSeedSet,
  hashDefinitionSeed,
  parseDefinitionSeedRequest,
  parseDefinitionSeedResult,
} from "@repo/domain/seed";
import type { StepDef } from "@repo/domain/workflow";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import {
  MODULE_KEY,
  definitionOf,
  field,
  rootToken,
} from "../../forms/test-support/form-fixtures";
import { reviewStep } from "../../workflows/test-support/workflow-fixtures";
import { DefinitionSeedModule } from "../definition-seed.module";
import { DefinitionSeedService } from "../definition-seed.service";
import { SeedInstallHooks } from "../seed-install-hooks";

/**
 * 受管定義安裝的測試夾具:宣告產生器、協定請求、共用互斥鎖的隔離夾具、資料庫最終狀態的讀取。
 * 測試檔只寫行為(TEST-07)。
 */

export const SEED_LOCK_OWNER = "seed-test-lock-owner";
export const SEED_RUN_ID = "seed-test-run";
export const SEED_RELEASE_COMMIT = "0123456789abcdef0123456789abcdef01234567";

export interface SeedTestApp {
  api: AuthTestApp;
  connection: Connection;
  /** 安裝的程序介面(CLI 背後唯一的入口)。 */
  seeds: DefinitionSeedService;
  hooks: SeedInstallHooks;
  /** root 的 access token(以真 GraphQL 模擬畫面上的操作)。 */
  root: string;
  rootUserId: Types.ObjectId;
}

/**
 * 完整 app + 安裝模組,同一個資料庫:畫面上的操作(發布、fork、送出)走真的 `/graphql`,
 * 安裝走 `DefinitionSeedService`(TEST-07 的第二個接縫 —— 它沒有 GraphQL 端點,正式入口是 CLI;
 * 子程序的 CLI 另由 `seed-cli.test.ts` 驗)。鎖已由夾具持有。
 */
export async function startSeedTestApp(
  databaseName: string,
): Promise<SeedTestApp> {
  const api = await startAuthTestApp(
    databaseName,
    { ROOT_ADMIN_ACCOUNT: ROOT_ADMIN.account },
    [DefinitionSeedModule],
  );
  await holdSeedLock(api.connection);
  const rootUser = await api.connection
    .collection("users")
    .findOne<{ _id: Types.ObjectId }>({ account: ROOT_ADMIN.account });
  if (!rootUser) {
    throw new Error("測試資料庫沒有 root 帳號(seed 未跑?)");
  }
  return {
    api,
    connection: api.connection,
    seeds: api.app.get(DefinitionSeedService),
    hooks: api.app.get(SeedInstallHooks),
    root: await rootToken(api),
    rootUserId: rootUser._id,
  };
}

// ---- 共用互斥鎖的隔離夾具 ----

/**
 * 模擬最外層命令(db-migrator 的 update / reset)持鎖:照 `@repo/domain/seed` 的鎖文件形狀
 * 直接寫進 `changelog_lock`。取得 / 釋放鎖的實作在 db-migrator,這裡只需要一筆符合契約的鎖。
 */
export async function holdSeedLock(
  connection: Connection,
  owner = SEED_LOCK_OWNER,
): Promise<void> {
  const lock: SeedLockDocument = {
    _id: SEED_LOCK_ID,
    owner,
    runId: SEED_RUN_ID,
    operation: "update",
    releaseCommit: SEED_RELEASE_COMMIT,
    startedAt: new Date(),
  };
  await connection
    .collection<SeedLockDocument>(SEED_LOCK_COLLECTION)
    .replaceOne({ _id: SEED_LOCK_ID }, lock, { upsert: true });
}

export async function releaseSeedLock(connection: Connection): Promise<void> {
  await connection
    .collection<SeedLockDocument>(SEED_LOCK_COLLECTION)
    .deleteOne({ _id: SEED_LOCK_ID });
}

// ---- 宣告 ----

export const SEED_FIELDS: FieldDef[] = [
  field("title", "text"),
  field("amount", "number", { permission: { show: true, edit: false } }),
];

/** 一份共用表單的宣告(預設掛示範表單模組、目標是發布)。 */
export function formSeed(
  key: string,
  revision: string,
  overrides: Partial<FormDefinitionSeedSet> & { fields?: FieldDef[] } = {},
): FormDefinitionSeedSet {
  const { fields = SEED_FIELDS, ...rest } = overrides;
  return {
    kind: "form-definition",
    key,
    revision,
    name: `受管表單 ${key}`,
    changelog: `發布 ${revision}`,
    desiredStatus: "published",
    moduleKey: MODULE_KEY,
    tabLabelTemplate: null,
    definition: definitionOf(fields),
    ...rest,
  };
}

/** 共用流程可用的關卡:直屬主管(不指名環境裡的人或角色)。 */
export function managerStep(key: string): StepDef {
  return reviewStep(key, { kind: "manager", level: 1 });
}

/** 共用流程可用的人員條件關卡:持有某權限、且屬於單據所屬組織的人。 */
export function permissionStep(key: string, permissionKey: string): StepDef {
  return reviewStep(key, {
    kind: "audience",
    audience: {
      mode: "match",
      filter: {
        op: "AND",
        children: [
          {
            field: "permission",
            cond: "in",
            value: { kind: "static", values: [permissionKey] },
          },
          {
            field: "org",
            cond: "in",
            value: { kind: "dynamic", ref: "submission-org" },
            range: "self",
          },
        ],
      },
    },
  });
}

export function workflowSeed(
  key: string,
  revision: string,
  overrides: Partial<WorkflowDefinitionSeedSet> & { steps?: StepDef[] } = {},
): WorkflowDefinitionSeedSet {
  const { steps = [managerStep("boss")], ...rest } = overrides;
  return {
    kind: "workflow-definition",
    key,
    revision,
    name: `受管流程 ${key}`,
    changelog: `發布 ${revision}`,
    desiredStatus: "published",
    checkFormKey: null,
    definition: { steps, edges: null },
    ...rest,
  };
}

/** 與 db-migrator 那一端相同的算法:共用契約的正規化 + SHA-256。 */
export function seedHashes(seed: DefinitionSeedSet): DefinitionSeedHashes {
  return hashDefinitionSeed(seed, (text) =>
    createHash("sha256").update(text, "utf8").digest("hex"),
  );
}

// ---- 協定 ----

export function seedRequest(
  seeds: DefinitionSeedSet[],
  operation: DefinitionSeedOperation = "apply",
  overrides: Partial<DefinitionSeedRequest> = {},
): DefinitionSeedRequest {
  return {
    protocolVersion: DEFINITION_SEED_PROTOCOL_VERSION,
    runId: SEED_RUN_ID,
    lockOwner: SEED_LOCK_OWNER,
    releaseCommit: SEED_RELEASE_COMMIT,
    operation,
    seeds,
    ...overrides,
  };
}

/**
 * 送一份請求並回結果;請求與結果都過共用契約的 `parse*`(JSON 來回一次,等同跨程序傳輸),
 * 形狀不符協定就在這裡失敗。
 */
export async function runSeeds(
  app: Pick<SeedTestApp, "seeds">,
  seeds: DefinitionSeedSet[],
  operation: DefinitionSeedOperation = "apply",
  overrides: Partial<DefinitionSeedRequest> = {},
): Promise<DefinitionSeedResult> {
  const requestWire = JSON.stringify(seedRequest(seeds, operation, overrides));
  const result = await app.seeds.execute(
    parseDefinitionSeedRequest(JSON.parse(requestWire)),
  );
  const resultWire = JSON.stringify(result);
  return parseDefinitionSeedResult(JSON.parse(resultWire), operation);
}

/** 只有一份宣告時取它的那一筆結果(沒有就讓測試失敗)。 */
export async function runSeed(
  app: Pick<SeedTestApp, "seeds">,
  seed: DefinitionSeedSet,
  operation: DefinitionSeedOperation = "apply",
  overrides: Partial<DefinitionSeedRequest> = {},
): Promise<DefinitionSeedItemResult> {
  const result = await runSeeds(app, [seed], operation, overrides);
  const [item] = result.results;
  if (result.errors.length > 0 || item === undefined) {
    throw new Error(`安裝沒有回結果:${JSON.stringify(result.errors)}`);
  }
  return item;
}

// ---- 資料庫最終狀態 ----

export interface RawDocument {
  _id: Types.ObjectId;
  [field: string]: unknown;
}

export interface InstallationDoc extends RawDocument {
  kind: string;
  key: string;
  revision: string;
  contentHash: string;
  snapshotHash: string;
  status: string;
  step: string;
  mode: string;
  definitionId: Types.ObjectId;
  draftId: Types.ObjectId | null;
  localVersion: number | null;
  runId: string;
  checkpoints: { step: string; runId: string }[];
}

export function installationOf(
  connection: Connection,
  seed: Pick<DefinitionSeedSet, "kind" | "key" | "revision">,
): Promise<InstallationDoc | null> {
  return connection
    .collection(SEED_DEFINITION_INSTALLATIONS_COLLECTION)
    .findOne<InstallationDoc>({
      kind: seed.kind,
      key: seed.key,
      revision: seed.revision,
    });
}

export function installationsOf(
  connection: Connection,
  key: string,
): Promise<InstallationDoc[]> {
  return connection
    .collection(SEED_DEFINITION_INSTALLATIONS_COLLECTION)
    .find<InstallationDoc>({ key })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
}

const VERSION_KEY_FIELD = {
  "form-definition": "formKey",
  "workflow-definition": "workflowKey",
} as const;

const DEFINITION_COLLECTION = {
  "form-definition": "forms",
  "workflow-definition": "workflows",
} as const;

const VERSION_COLLECTION = {
  "form-definition": "form_versions",
  "workflow-definition": "workflow_versions",
} as const;

export function definitionDoc(
  connection: Connection,
  kind: DefinitionSeedSet["kind"],
  key: string,
): Promise<RawDocument | null> {
  return connection
    .collection(DEFINITION_COLLECTION[kind])
    .findOne<RawDocument>({ key });
}

/** 全部版本(含草稿),依建立順序。 */
export function versionDocs(
  connection: Connection,
  kind: DefinitionSeedSet["kind"],
  key: string,
): Promise<RawDocument[]> {
  return connection
    .collection(VERSION_COLLECTION[kind])
    .find<RawDocument>({ [VERSION_KEY_FIELD[kind]]: key })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
}

export function auditCount(
  connection: Connection,
  filter: Record<string, unknown> = {},
): Promise<number> {
  return connection.collection("audit_logs").countDocuments(filter);
}

/** 某個對象(表單 / 流程 / 版本)留下的稽核動作,依時間。 */
export async function auditActionsOf(
  connection: Connection,
  targetIds: Types.ObjectId[],
): Promise<string[]> {
  const logs = await connection
    .collection("audit_logs")
    .find<{ action: string }>({ targetId: { $in: targetIds } })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  return logs.map((log) => log.action);
}

/**
 * 一個定義「會被重跑改到的東西」的完整快照:身分、全部版本、安裝紀錄、稽核筆數。
 * 重跑未變時整份要逐欄相等(含 `updatedAt`、`publishedAt`)。
 */
export async function persistedStateOf(
  connection: Connection,
  kind: DefinitionSeedSet["kind"],
  key: string,
): Promise<unknown> {
  return {
    definition: await definitionDoc(connection, kind, key),
    versions: await versionDocs(connection, kind, key),
    installations: await installationsOf(connection, key),
    permissions: await connection
      .collection("permissions")
      .find({ key: { $regex: `-${key}-` } })
      .sort({ key: 1 })
      .toArray(),
    audits: await auditCount(connection),
  };
}

export function newObjectId(): Types.ObjectId {
  return new Types.ObjectId();
}
