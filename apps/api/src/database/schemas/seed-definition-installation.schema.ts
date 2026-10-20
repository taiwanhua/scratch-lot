import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Schema as MongooseSchema, type Types } from "mongoose";

import type { SerialFormat } from "@repo/domain/form";
import {
  DEFINITION_DESIRED_STATUSES,
  DEFINITION_SEED_KINDS,
  type DefinitionDesiredStatus,
  type DefinitionSeedKind,
  SEED_DEFINITION_INSTALLATIONS_COLLECTION,
} from "@repo/domain/seed";

import { baseFieldsPlugin } from "../plugins/base-fields.plugin";

/**
 * 安裝紀錄的處理狀態:
 * - `in-progress`:已登記(所有權在第一筆身分 / 版本寫入前建立),還沒核對完成;只可由同一個
 *   revision、同一組 hash 接續
 * - `installed`:這個 revision 已對應到 `definitionId` + `localVersion`,且寫入前核對過實體
 */
export const SEED_INSTALLATION_STATUSES = ["in-progress", "installed"] as const;

export type SeedInstallationStatus =
  (typeof SEED_INSTALLATION_STATUSES)[number];

/**
 * 可續跑的檢查點(依寫入順序)。每一步做完才記;中斷後以實體的實際狀態判斷接續點,
 * 這一欄是「上次確認做到哪」的紀錄,不是唯一依據。
 */
export const SEED_INSTALLATION_STEPS = [
  /** 已登記:id、預期前置狀態與兩個 hash 都記下了,還沒有任何身分 / 版本寫入。 */
  "reserved",
  /** 身分(表單 / 流程)已存在且 id 相符。 */
  "identity",
  /** 受管 metadata(名稱、頁籤模板)已是目標值。 */
  "metadata",
  /** 預配置 id 的草稿已建立。 */
  "draft",
  /** 草稿內容已是這次要交付的定義。 */
  "saved",
  /** 已發布且 `currentVersion` 指向它(`localVersion` 已知)。 */
  "published",
  /** 明示退役已完成(`currentVersion` 為 null)。 */
  "retired",
  /** 核對完成。 */
  "installed",
] as const;

export type SeedInstallationStep = (typeof SEED_INSTALLATION_STEPS)[number];

/** 這個 revision 是怎麼對應到該環境版本的(回報結果用;重跑未變時不改)。 */
export const SEED_INSTALLATION_MODES = [
  "created",
  "updated",
  "adopted",
] as const;

export type SeedInstallationMode = (typeof SEED_INSTALLATION_MODES)[number];

/** 該版的受管 metadata 快照(歷史 inspect 以它核對,不拿目前身分的名稱比)。 */
export interface SeedInstallationMetadata {
  name: string;
  /** 表單才有。 */
  moduleKey?: string;
  tabLabelTemplate?: string | null;
  /** 表單才有:允許存草稿(缺席 = 開;這個欄位之前的快照沒有它)。 */
  allowDraft?: boolean;
  /** 表單才有:單號格式(缺席 = 不給號;這個欄位之前的快照沒有它)。 */
  serial?: SerialFormat | null;
  /** 表單才有:作廢原因類別(缺席 = 自由填寫;這個欄位之前的快照沒有它)。 */
  voidReasonCategoryKey?: string | null;
  /** 流程才有。 */
  checkFormKey?: string | null;
}

/** 登記當下看到的前置狀態:接續時以它判斷「是不是自己先前的寫入」。 */
export interface SeedInstallationExpectation {
  /** 登記時身分是否已存在(false = 由這次安裝建立)。 */
  definitionExists: boolean;
  currentVersion: number | null;
  /** 登記時身分上的名稱 / 頁籤模板;身分不存在為 null。 */
  metadata: {
    name: string;
    tabLabelTemplate?: string | null;
    allowDraft?: boolean;
    serial?: SerialFormat | null;
    voidReasonCategoryKey?: string | null;
  } | null;
}

export interface SeedInstallationCheckpoint {
  step: SeedInstallationStep;
  runId: string;
  at: Date;
}

/**
 * 受管定義的安裝紀錄(`docs/concepts/data-layer-and-isolation.md`「受管表單與流程」):
 * 跨環境以 `(kind, key, revision)` 識別一份定義宣告,這裡記它在**本環境**對應到哪個定義 id 與版號
 * (各環境的 id 與歷史版號不必相同)。受管範圍的真相仍是當前 registry,這張表只是映射與續跑依據。
 *
 * **不掛 `tenantScopePlugin`**:只有共用定義(`ownerOrgId = null`)會被安裝,這是全域設定資料。
 * 只經 `seed/` 的安裝流程寫入;表單 / 流程本體一律走原設計服務,不經這張表改。
 */
@Schema({
  collection: SEED_DEFINITION_INSTALLATIONS_COLLECTION,
  timestamps: true,
  minimize: false,
})
export class SeedDefinitionInstallation {
  @Prop({ type: String, required: true, enum: DEFINITION_SEED_KINDS })
  kind!: DefinitionSeedKind;

  /** 表單 / 流程 key。 */
  @Prop({ type: String, required: true })
  key!: string;

  /** 專案內該 key 的不變發布識別字串(不是版號)。 */
  @Prop({ type: String, required: true })
  revision!: string;

  /** 內容 hash(不含 revision / changelog / desiredStatus);兩個環境目標內容相同時相同。 */
  @Prop({ type: String, required: true })
  contentHash!: string;

  /** 整份宣告的 hash:同一個 revision 不可改內容。 */
  @Prop({ type: String, required: true })
  snapshotHash!: string;

  /**
   * 落庫後內容的 hash:宣告經設計服務同一套整形(名稱去空白、流程節點補成固定形狀)後算的值,
   * 拿來與資料庫裡的版本比。匯出的宣告本來就是落庫的形狀,這個值與 `contentHash` 相同。
   */
  @Prop({ type: String, required: true })
  storedContentHash!: string;

  @Prop({ type: String, required: true, enum: DEFINITION_DESIRED_STATUSES })
  desiredStatus!: DefinitionDesiredStatus;

  @Prop({ type: String, required: true, enum: SEED_INSTALLATION_STATUSES })
  status!: SeedInstallationStatus;

  @Prop({ type: String, required: true, enum: SEED_INSTALLATION_STEPS })
  step!: SeedInstallationStep;

  @Prop({ type: String, required: true, enum: SEED_INSTALLATION_MODES })
  mode!: SeedInstallationMode;

  /** 本環境的定義 id;由這次安裝建立時是預先配好的 id。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  definitionId!: Types.ObjectId;

  /** 預先配好的草稿 id(發布後就是那一版的 id);採納既有版本時為 null。 */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  draftId!: Types.ObjectId | null;

  /** 本環境的版號;配置前為 null。 */
  @Prop({ type: Number, default: null })
  localVersion!: number | null;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  metadata!: SeedInstallationMetadata;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  expected!: SeedInstallationExpectation;

  /** 登記這筆紀錄的執行。 */
  @Prop({ type: String, required: true })
  runId!: string;

  /** 登記時的設定版本(與 api image 的 SHA 分開記)。 */
  @Prop({ type: String, required: true })
  releaseCommit!: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  checkpoints!: SeedInstallationCheckpoint[];

  @Prop({ type: Date, default: null })
  installedAt!: Date | null;
}

// 由 class 產生 Mongoose Schema(供 MongooseModule 註冊為 model,並掛下方索引)
export const SeedDefinitionInstallationSchema = SchemaFactory.createForClass(
  SeedDefinitionInstallation,
);

// 一份宣告在一個環境只有一筆紀錄:同時來的兩次登記只有一個成立
SeedDefinitionInstallationSchema.index(
  { kind: 1, key: 1, revision: 1 },
  { unique: true },
);
// 找某個 key 的上次安裝與未完成的安裝
SeedDefinitionInstallationSchema.index({ kind: 1, key: 1, status: 1 });
// 基礎欄位(ADR-0007);全域設定資料,不掛 tenantScope(理由見 class 註解)
SeedDefinitionInstallationSchema.plugin(baseFieldsPlugin);
