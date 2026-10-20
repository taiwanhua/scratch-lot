import type { Types } from "mongoose";

import { type SerialFormat, normalizeSerialFormat } from "@repo/domain/form";
import type {
  DefinitionSeedOperation,
  DefinitionSeedSet,
} from "@repo/domain/seed";

import type { SeedInstallationMetadata } from "../database/schemas/seed-definition-installation.schema";
import type { FormOperatorFacts } from "../forms/form-access.service";

/**
 * 一筆定義無法安裝的具體原因(協定的 `conflict`):`code` 給程式判斷、`message` 給操作者。
 * 衝突一律在該步的寫入**之前**丟出;不是衝突的失敗(原服務丟的錯、資料庫錯誤)照原樣往上丟。
 */
export class SeedConflictError extends Error {
  override name = "SeedConflictError";

  constructor(
    readonly code: SeedConflictCode,
    message: string,
  ) {
    super(message);
  }
}

export const SEED_CONFLICT_CODES = [
  /** 同一個 revision 的內容與已登記的不同(revision 不可改內容)。 */
  "REVISION_HASH_MISMATCH",
  /** 同 key 的定義屬於租戶(客製 / fork),不是共用定義。 */
  "OWNER_MISMATCH",
  /** 表單掛的模組與宣告不同(模組建立後不可改)。 */
  "MODULE_MISMATCH",
  /** 初次納管:同 key 的共用定義已存在,但目前發布內容與宣告不同。 */
  "UNMANAGED_DEFINITION",
  /** `currentVersion` 不是預期的版本(現場另外發布 / 退役過)。 */
  "CURRENT_VERSION_DRIFT",
  /** 名稱 / 頁籤模板與預期不同(現場改過)。 */
  "METADATA_DRIFT",
  /** 有不是這次安裝建立的設計草稿。 */
  "UNEXPECTED_DRAFT",
  /** 這次安裝建立的草稿被別人改過。 */
  "DRAFT_DRIFT",
  /** 同 key 另一個 revision 的安裝還沒完成(先以原 revision 續跑)。 */
  "INSTALLATION_IN_PROGRESS",
  /** 安裝紀錄指向的定義不存在。 */
  "DEFINITION_MISSING",
  /** 同 key 的定義 id 與安裝紀錄不同(定義被刪掉重建過)。 */
  "DEFINITION_ID_MISMATCH",
  /** 安裝紀錄指向的版本不存在。 */
  "VERSION_MISSING",
  /** 版本凍結的內容與宣告不同。 */
  "CONTENT_MISMATCH",
  /** 定義檢查器不通過(缺模組、缺被引用的表單…)。 */
  "DEFINITION_INVALID",
  /** 發布該有的欄位級權限不齊。 */
  "PERMISSIONS_INCOMPLETE",
] as const;

export type SeedConflictCode = (typeof SEED_CONFLICT_CODES)[number];

/** 身分(表單 / 流程)上可改的受管 metadata;`tabLabelTemplate`、`allowDraft` 只有表單有。 */
export interface IdentityMetadata {
  name: string;
  tabLabelTemplate?: string | null;
  /** 允許存草稿;缺席 = 開(流程、這個欄位之前的安裝快照)。 */
  allowDraft?: boolean;
  /** 單號格式;缺席 / null = 不給號(流程、這個欄位之前的安裝快照)。 */
  serial?: SerialFormat | null;
}

/** 條件更新 metadata 的前置狀態:哪一筆定義、當時的目前版本與 metadata。 */
export interface IdentityExpectation {
  definitionId: Types.ObjectId;
  currentVersion: number | null;
  metadata: IdentityMetadata;
}

export function isSameIdentityMetadata(
  left: IdentityMetadata,
  right: IdentityMetadata,
): boolean {
  return (
    left.name === right.name &&
    (left.tabLabelTemplate ?? null) === (right.tabLabelTemplate ?? null) &&
    (left.allowDraft ?? true) === (right.allowDraft ?? true) &&
    JSON.stringify(normalizeSerialFormat(left.serial ?? null)) ===
      JSON.stringify(normalizeSerialFormat(right.serial ?? null))
  );
}

/** 一個定義身分此刻的狀態(只有安裝流程判斷要用的欄位)。 */
export interface DefinitionSnapshot {
  id: Types.ObjectId;
  /** 共用定義(`ownerOrgId = null`);false = 某個租戶的客製 / fork。 */
  isShared: boolean;
  /** 表單才有:掛在哪個模組。 */
  moduleKey: string | null;
  currentVersion: number | null;
  metadata: IdentityMetadata;
}

/** 一個版本此刻的狀態。 */
export interface VersionSnapshot {
  id: Types.ObjectId;
  version: number | null;
  status: string;
  draftRevision: number;
  /** 這一版的內容 hash;受管 metadata 由呼叫端給(目前身分的,或安裝時的快照)。 */
  contentHashWith: (metadata: IdentityMetadata) => string;
}

/**
 * 表單與流程各一份的適配:安裝流程(`DefinitionInstaller`)只認這個介面。
 * 讀取經 repository;**每一個寫入都轉呼叫原設計服務**(建立、改名、開草稿、存草稿、發布、重試、退役),
 * 權限守門、檢查器、版本生命週期、動態權限與稽核都沿用原實作,這裡不複製狀態機。
 */
export interface DefinitionAdapter<
  TSeed extends DefinitionSeedSet = DefinitionSeedSet,
> {
  readonly kind: TSeed["kind"];

  /** 這個操作實際會用到的既有權限(resolver 的 decorator 在 CLI 不會執行,由安裝流程自己驗)。 */
  permissionsFor(operation: DefinitionSeedOperation): readonly string[];

  /** 宣告在身分上的目標 metadata。 */
  identityMetadataOf(seed: TSeed): IdentityMetadata;

  /** 剛由原服務建立時身分上的 metadata(表單建立時不收頁籤模板,之後才改)。 */
  initialMetadataOf(seed: TSeed): IdentityMetadata;

  /** 存進安裝紀錄的受管 metadata 快照。 */
  installationMetadataOf(seed: TSeed): SeedInstallationMetadata;

  /** 依 key 找定義,不分共用或租戶(租戶的只回身分,供所有權檢查)。 */
  findDefinition(
    facts: FormOperatorFacts,
    key: string,
  ): Promise<DefinitionSnapshot | null>;

  findVersionById(
    facts: FormOperatorFacts,
    key: string,
    id: Types.ObjectId,
  ): Promise<VersionSnapshot | null>;

  findVersionByNumber(
    facts: FormOperatorFacts,
    key: string,
    version: number,
  ): Promise<VersionSnapshot | null>;

  findDraft(
    facts: FormOperatorFacts,
    key: string,
  ): Promise<VersionSnapshot | null>;

  /** 版號最大的那一版(沒有發布過為 null)。 */
  findLatestVersion(
    facts: FormOperatorFacts,
    key: string,
  ): Promise<VersionSnapshot | null>;

  /** 寫入前的定義檢查(原檢查器);回問題清單,空陣列 = 可發布。 */
  validate(facts: FormOperatorFacts, seed: TSeed): Promise<string[]>;

  createIdentity(
    facts: FormOperatorFacts,
    seed: TSeed,
    definitionId: Types.ObjectId,
  ): Promise<void>;

  /**
   * 條件更新:還是比對時看到的那一筆定義、同一個 `currentVersion`、同一份 metadata 才改成宣告的值
   * (條件由原服務放進同一次寫入)。
   */
  updateMetadata(
    facts: FormOperatorFacts,
    seed: TSeed,
    expected: IdentityExpectation,
  ): Promise<void>;

  createDraft(
    facts: FormOperatorFacts,
    key: string,
    draftId: Types.ObjectId,
  ): Promise<void>;

  /** 只存預配置 id 的那一份草稿(被刪掉重開的別人草稿不會被動到)。 */
  saveDraft(
    facts: FormOperatorFacts,
    seed: TSeed,
    draftId: Types.ObjectId,
    expectedDraftRevision: number,
  ): Promise<void>;

  /**
   * 只發布預配置 id 的那一份草稿,而且定義與 `currentVersion` 還是登記時的樣子
   * (`expected`,由原服務在配版號前判斷)。
   */
  publish(
    facts: FormOperatorFacts,
    seed: TSeed,
    draftId: Types.ObjectId,
    expectedDraftRevision: number,
    expected: { definitionId: Types.ObjectId; currentVersion: number | null },
  ): Promise<void>;

  retire(
    facts: FormOperatorFacts,
    key: string,
    expectedVersion: number,
  ): Promise<void>;

  /** 發布後該有而沒有的動態權限 key(流程沒有欄位級權限,回空陣列)。 */
  missingPermissions(facts: FormOperatorFacts, seed: TSeed): Promise<string[]>;
}
