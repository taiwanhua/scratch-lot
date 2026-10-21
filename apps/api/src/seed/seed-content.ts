/* eslint-disable unicorn/prefer-structured-clone -- 這裡要的是「轉成純 JSON 值」不是深拷貝:Mongoose 的陣列 / 子文件經 toJSON 才變成純陣列與純物件,structuredClone 做不到;到期條件:無 */
import { createHash } from "node:crypto";

import {
  type FormDefinition,
  type SerialFormat,
  normalizeSerialFormat,
} from "@repo/domain/form";
import {
  type DefinitionSeedHashes,
  type DefinitionSeedSet,
  type FormDefinitionSeedSet,
  type WorkflowDefinitionSeedSet,
  hashDefinitionSeed,
} from "@repo/domain/seed";
import type { WorkflowDefinition } from "@repo/domain/workflow";

import {
  checkFormKeyFromInput,
  definitionFromInput,
} from "../workflows/workflow-definition-input";

/**
 * 定義內容的 hash(共用契約 `@repo/domain/seed` 的正規化 + Node 的 SHA-256)與「落庫後的形狀」。
 *
 * 設計服務存草稿時會整形輸入(名稱去頭尾空白、空白的頁籤模板 / 檢查用表單存成 null、流程節點補成固定形狀),
 * 所以拿宣告與資料庫裡的版本相比時,宣告要先過同一套整形(`shapeDefinitionSeed`)再算 hash;
 * 回報給呼叫端的 `contentHash` / `snapshotHash` 仍是原宣告的值(兩個環境、兩端程序算出來相同)。
 */

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** 一份宣告的兩個 hash(協定回報用,不整形)。 */
export function hashesOfSeed(seed: DefinitionSeedSet): DefinitionSeedHashes {
  return hashDefinitionSeed(seed, sha256Hex);
}

/** 轉成純 JSON 值:資料庫讀出的陣列 / 子文件不是純陣列與純物件,共用契約的正規化不收。 */
function plain<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

/** 空白 = 沒有(同 `FormsService.update` 存頁籤模板的規則)。 */
function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function shapeFormSeed(seed: FormDefinitionSeedSet): FormDefinitionSeedSet {
  return {
    ...seed,
    name: seed.name.trim(),
    tabLabelTemplate: blankToNull(seed.tabLabelTemplate),
    // 單號格式存檔時正規化(固定鍵、分隔符缺席不存),hash 比對用同一個形狀
    ...(seed.serial === undefined
      ? {}
      : { serial: normalizeSerialFormat(seed.serial) ?? seed.serial }),
    definition: plain(seed.definition),
  };
}

function shapeWorkflowSeed(
  seed: WorkflowDefinitionSeedSet,
): WorkflowDefinitionSeedSet {
  return {
    ...seed,
    name: seed.name.trim(),
    checkFormKey: checkFormKeyFromInput(seed.checkFormKey) ?? null,
    definition: plain(
      definitionFromInput({
        steps: seed.definition.steps as unknown as Record<string, unknown>[],
        edges: seed.definition.edges,
        // 宣告沒寫或 null = 沒設(整形後不帶這個鍵,與資料庫讀回的定義一致)
        cc: seed.definition.cc ?? undefined,
      }),
    ),
  };
}

/** 宣告 → 設計服務存進資料庫後的形狀(與原服務同一套整形,不另寫規則)。 */
export function shapeDefinitionSeed<TSeed extends DefinitionSeedSet>(
  seed: TSeed,
): TSeed {
  return (
    seed.kind === "form-definition"
      ? shapeFormSeed(seed)
      : shapeWorkflowSeed(seed)
  ) as TSeed;
}

/** 只算內容 hash 時補上的佔位值(revision / changelog / desiredStatus 不進 `contentHash`)。 */
const CONTENT_ONLY = {
  revision: "content",
  changelog: "content",
  desiredStatus: "published",
} as const;

/** 資料庫裡一版表單的內容 hash(受管 metadata 由呼叫端給:目前身分的,或安裝時的快照)。 */
export function formContentHash(
  identity: {
    key: string;
    moduleKey: string;
    name: string;
    tabLabelTemplate: string | null;
    /** 缺席 = 開 */
    allowDraft?: boolean;
    /** 缺席 / null = 不給號 */
    serial?: SerialFormat | null;
    /** 缺席 / null = 作廢原因自由填寫 */
    voidReasonCategoryKey?: string | null;
  },
  definition: FormDefinition,
): string {
  const { serial, voidReasonCategoryKey, ...rest } = identity;
  const format = normalizeSerialFormat(serial ?? null);
  return hashesOfSeed({
    kind: "form-definition",
    ...CONTENT_ONLY,
    ...rest,
    ...(format === null ? {} : { serial: format }),
    ...(voidReasonCategoryKey === null || voidReasonCategoryKey === undefined
      ? {}
      : { voidReasonCategoryKey }),
    definition: plain(definition),
  }).contentHash;
}

/** 資料庫裡一版流程的內容 hash。 */
export function workflowContentHash(
  identity: { key: string; name: string; checkFormKey: string | null },
  definition: WorkflowDefinition,
): string {
  return hashesOfSeed({
    kind: "workflow-definition",
    ...CONTENT_ONLY,
    ...identity,
    definition: plain(definition),
  }).contentHash;
}
