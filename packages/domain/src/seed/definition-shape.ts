/**
 * 定義宣告的**形狀**檢查:頂層鍵、key / revision 格式、必填與 `null` 語意、definition 的外框。
 * 來源可能是跨程序的 JSON 或手改的匯出檔,型別保證不了,所以輸入是 `unknown`。
 * 業務內容(欄位、關卡)的檢查在可攜性檢查與既有定義檢查器。
 */
import { FORM_KEY_PATTERN, isValidFieldCategoryKey } from "../form/keys";
import { serialFormatIssues } from "../form/serial";
import { sharedByFieldIssues } from "../form/shared-by-fields";
import type { FieldDef } from "../form/types";
import {
  SeedSerializationError,
  assertPureSeedData,
  isPlainRecord,
  joinSeedPath,
} from "./canonical";
import {
  DEFINITION_DESIRED_STATUSES,
  DEFINITION_REVISION_PATTERN,
  DEFINITION_SEED_KINDS,
  type DefinitionSeedSet,
} from "./declaration";

/** 形狀問題:`path` 是宣告內的位置(頂層為空字串)。 */
export interface DefinitionSeedShapeIssue {
  path: string;
  detail: string;
}

const COMMON_KEYS = [
  "kind",
  "key",
  "revision",
  "name",
  "changelog",
  "desiredStatus",
  "definition",
] as const;

const TOP_LEVEL_KEYS: Readonly<
  Record<DefinitionSeedSet["kind"], readonly string[]>
> = {
  "form-definition": [
    ...COMMON_KEYS,
    "moduleKey",
    "tabLabelTemplate",
    "allowDraft",
    "serial",
    "voidReasonCategoryKey",
    "sharedByFieldKeys",
  ],
  "workflow-definition": [...COMMON_KEYS, "checkFormKey"],
};

const DEFINITION_KEYS: Readonly<
  Record<DefinitionSeedSet["kind"], readonly string[]>
> = {
  "form-definition": ["fields", "layout", "summaryMap", "prefills"],
  "workflow-definition": ["steps", "edges", "cc"],
};

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function unknownKeyIssues(
  record: Record<string, unknown>,
  allowed: readonly string[],
  base: string,
): DefinitionSeedShapeIssue[] {
  return Object.keys(record)
    .filter((key) => record[key] !== undefined && !allowed.includes(key))
    .map((key) => ({
      path: joinSeedPath(base, key),
      detail: `宣告不收這個欄位(${key});資料庫 id、版號、時間戳、分派與綁定都不隨設定交付`,
    }));
}

function commonIssues(
  seed: Record<string, unknown>,
): DefinitionSeedShapeIssue[] {
  const issues: DefinitionSeedShapeIssue[] = [];
  if (typeof seed.key !== "string" || !FORM_KEY_PATTERN.test(seed.key)) {
    issues.push({
      path: "key",
      detail: "key 格式不符(小寫開頭,只允許小寫、數字、底線,最長 40)",
    });
  }
  if (
    typeof seed.revision !== "string" ||
    !DEFINITION_REVISION_PATTERN.test(seed.revision)
  ) {
    issues.push({
      path: "revision",
      detail:
        "revision 格式不符(小寫英數開頭,只允許小寫英數、底線、連字號,最長 64)",
    });
  }
  if (!isNonBlankString(seed.name)) {
    issues.push({ path: "name", detail: "name 必填" });
  }
  if (!isNonBlankString(seed.changelog)) {
    issues.push({ path: "changelog", detail: "changelog(發布說明)必填" });
  }
  if (
    !(DEFINITION_DESIRED_STATUSES as readonly unknown[]).includes(
      seed.desiredStatus,
    )
  ) {
    issues.push({
      path: "desiredStatus",
      detail: `desiredStatus 必須是 ${DEFINITION_DESIRED_STATUSES.join(" 或 ")}`,
    });
  }
  return issues;
}

/** 必填且以 `null` 表示清空的字串欄位:缺席不等於 `null`。 */
function nullableStringIssues(
  seed: Record<string, unknown>,
  key: string,
): DefinitionSeedShapeIssue[] {
  const value = seed[key];
  return value === null || typeof value === "string"
    ? []
    : [{ path: key, detail: `${key} 必填;要清空請明寫 null` }];
}

/** 作廢原因類別:缺席合格;有寫就要是欄位管理類別 key。 */
function voidReasonCategoryIssues(value: unknown): DefinitionSeedShapeIssue[] {
  return value === undefined ||
    (typeof value === "string" && isValidFieldCategoryKey(value))
    ? []
    : [
        {
          path: "voidReasonCategoryKey",
          detail:
            "voidReasonCategoryKey 必須是欄位管理類別 key(小寫英數與連字號);缺席 = 作廢原因自由填寫",
        },
      ];
}

const SHARED_BY_FIELD_DETAIL: Record<
  ReturnType<typeof sharedByFieldIssues>[number]["reason"],
  string
> = {
  notFound: "不是 definition.fields 裡的欄位",
  notOrgReference: "不是引用組織的欄位(type reference、source.provider org)",
  duplicate: "重複",
};

/** 依欄位共用:缺席合格;有寫就要是非空陣列、每個都是表單層的組織引用欄(不重複)。 */
function sharedByFieldKeysIssues(
  value: unknown,
  definition: unknown,
): DefinitionSeedShapeIssue[] {
  if (value === undefined) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((key) => typeof key !== "string")
  ) {
    return [
      {
        path: "sharedByFieldKeys",
        detail:
          "sharedByFieldKeys 必須是非空的欄位 key 陣列;缺席 = 不依欄位共用",
      },
    ];
  }
  const fields =
    isPlainRecord(definition) && Array.isArray(definition.fields)
      ? (definition.fields as FieldDef[])
      : [];
  return sharedByFieldIssues(fields, value as string[]).map((issue) => ({
    path: "sharedByFieldKeys",
    detail: `${issue.key}:${SHARED_BY_FIELD_DETAIL[issue.reason]}`,
  }));
}

function formIssues(seed: Record<string, unknown>): DefinitionSeedShapeIssue[] {
  const issues = nullableStringIssues(seed, "tabLabelTemplate");
  if (seed.allowDraft !== undefined && typeof seed.allowDraft !== "boolean") {
    issues.push({
      path: "allowDraft",
      detail: "allowDraft 只能是 true / false;缺席 = 允許存草稿",
    });
  }
  if (seed.serial !== undefined) {
    for (const issue of serialFormatIssues(seed.serial)) {
      issues.push({
        path: issue.path === "" ? "serial" : `serial.${issue.path}`,
        detail: `${issue.detail};缺席 = 不給單號`,
      });
    }
  }
  issues.push(
    ...voidReasonCategoryIssues(seed.voidReasonCategoryKey),
    ...sharedByFieldKeysIssues(seed.sharedByFieldKeys, seed.definition),
  );
  if (!isNonBlankString(seed.moduleKey)) {
    issues.push({ path: "moduleKey", detail: "moduleKey 必填" });
  }
  const definition = seed.definition;
  if (!isPlainRecord(definition)) {
    return issues;
  }
  if (!Array.isArray(definition.fields)) {
    issues.push({ path: "definition.fields", detail: "fields 必須是陣列" });
  }
  if (
    !isPlainRecord(definition.layout) ||
    !Array.isArray(definition.layout.sections)
  ) {
    issues.push({
      path: "definition.layout",
      detail: "layout.sections 必須是陣列",
    });
  }
  if (!isPlainRecord(definition.summaryMap)) {
    issues.push({
      path: "definition.summaryMap",
      detail: "summaryMap 必須是物件",
    });
  }
  if (!Array.isArray(definition.prefills)) {
    issues.push({ path: "definition.prefills", detail: "prefills 必須是陣列" });
  }
  return issues;
}

function workflowIssues(
  seed: Record<string, unknown>,
): DefinitionSeedShapeIssue[] {
  const issues = nullableStringIssues(seed, "checkFormKey");
  if (
    typeof seed.checkFormKey === "string" &&
    !FORM_KEY_PATTERN.test(seed.checkFormKey)
  ) {
    issues.push({
      path: "checkFormKey",
      detail: "checkFormKey 不是表單 key 格式",
    });
  }
  const definition = seed.definition;
  if (!isPlainRecord(definition)) {
    return issues;
  }
  if (!Array.isArray(definition.steps)) {
    issues.push({ path: "definition.steps", detail: "steps 必須是陣列" });
  }
  const edges = definition.edges;
  if (edges !== undefined && edges !== null && !Array.isArray(edges)) {
    issues.push({
      path: "definition.edges",
      detail: "edges 必須是陣列、null 或不寫",
    });
  }
  return issues;
}

/** 全部形狀問題;空陣列 = 可以當成 `DefinitionSeedSet` 繼續檢查。 */
export function definitionSeedShapeIssues(
  seed: unknown,
): DefinitionSeedShapeIssue[] {
  if (!isPlainRecord(seed)) {
    return [{ path: "", detail: "定義宣告必須是物件" }];
  }
  // 先確認是純資料(不執行 accessor);不是的話後面讀到的值不可信,只回這一項
  try {
    assertPureSeedData(seed);
  } catch (error) {
    if (error instanceof SeedSerializationError) {
      return [{ path: error.path, detail: error.detail }];
    }
    throw error;
  }
  const kind = (DEFINITION_SEED_KINDS as readonly unknown[]).includes(seed.kind)
    ? (seed.kind as DefinitionSeedSet["kind"])
    : null;
  if (kind === null) {
    return [
      {
        path: "kind",
        detail: `kind 必須是 ${DEFINITION_SEED_KINDS.join(" 或 ")}`,
      },
    ];
  }
  const issues = [
    ...unknownKeyIssues(seed, TOP_LEVEL_KEYS[kind], ""),
    ...commonIssues(seed),
  ];
  if (isPlainRecord(seed.definition)) {
    issues.push(
      ...unknownKeyIssues(seed.definition, DEFINITION_KEYS[kind], "definition"),
    );
  } else {
    issues.push({ path: "definition", detail: "definition 必須是物件" });
  }
  issues.push(
    ...(kind === "form-definition" ? formIssues(seed) : workflowIssues(seed)),
  );
  return issues;
}

/** 形狀合格才回傳 true(型別守衛)。 */
export function isDefinitionSeedShape(
  seed: unknown,
): seed is DefinitionSeedSet {
  return definitionSeedShapeIssues(seed).length === 0;
}
