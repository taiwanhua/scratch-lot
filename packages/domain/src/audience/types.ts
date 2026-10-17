/**
 * 人員條件(套用對象 / 審核者 / 知會 / 逾時通知 / 收件人共用的「選出一群人」格式)的型別與詞彙。
 * 條件樹形狀與資料範圍的條件組合同一種:群組 `op` + `children`、條件列 `field` + `cond` + `value`。
 */

/** 人員條件可用的欄位:使用者 / 角色 / 所屬組織 / 權限。 */
export const AUDIENCE_FIELDS = ["user", "role", "org", "permission"] as const;

export type AudienceField = (typeof AUDIENCE_FIELDS)[number];

/**
 * 比較方式只有一種:「屬於」(權限欄顯示為「持有」)。刻意不提供「不屬於」:
 * 列出符合的人時要能從條件反推名單,不掃全部使用者。
 */
export const AUDIENCE_CONDITIONS = ["in"] as const;

export type AudienceCondition = (typeof AUDIENCE_CONDITIONS)[number];

/** 所屬組織的範圍:本身 / 含下層 / 含上層。 */
export const AUDIENCE_ORG_RANGES = [
  "self",
  "descendants",
  "ancestors",
] as const;

export type AudienceOrgRange = (typeof AUDIENCE_ORG_RANGES)[number];

/** 群組運算子(每層可切)。 */
export const AUDIENCE_GROUP_OPS = ["AND", "OR"] as const;

export type AudienceGroupOp = (typeof AUDIENCE_GROUP_OPS)[number];

/** 群組最多幾層(根群組算第 1 層;與條件組合的 UI 上限相同)。 */
export const AUDIENCE_MAX_DEPTH = 3;

/** `form-field:<欄位 key>` 的前綴:表單的組織引用欄。 */
export const AUDIENCE_FORM_FIELD_REF_PREFIX = "form-field:";

/**
 * 非指定的組織來源(`value.kind = "dynamic"` 的 `ref`),在解析當下由使用處代入:
 * - `submission-org`:單據所屬組織
 * - `tenant`:租戶
 * - `form-field:<欄位 key>`:表單的組織欄位
 * - `event-org`:事件的組織(通知類型宣告,例:事件的分店)
 */
export type AudienceDynamicRef =
  | "submission-org"
  | "tenant"
  | "event-org"
  | `${typeof AUDIENCE_FORM_FIELD_REF_PREFIX}${string}`;

/**
 * 組織的來源種類(呼叫端宣告該使用處能用哪幾種):`static` = 指定組織,
 * 其餘對應 `AudienceDynamicRef`(`form-field` 涵蓋所有 `form-field:<key>`)。
 */
export const AUDIENCE_ORG_SOURCES = [
  "static",
  "submission-org",
  "tenant",
  "form-field",
  "event-org",
] as const;

export type AudienceOrgSource = (typeof AUDIENCE_ORG_SOURCES)[number];

export type AudienceValue =
  | { kind: "static"; values: string[] }
  | { kind: "dynamic"; ref: AudienceDynamicRef };

/** 條件列。`range` 只有所屬組織欄有(且必填)。 */
export interface AudienceLeaf {
  field: AudienceField;
  cond: AudienceCondition;
  value: AudienceValue;
  range?: AudienceOrgRange;
}

export interface AudienceGroup {
  op: AudienceGroupOp;
  children: AudienceNode[];
}

export type AudienceNode = AudienceGroup | AudienceLeaf;

/** 頂層明確二選一:「所有人」/「符合條件」(至少一個條件列);不用「空白 = 所有人」。 */
export type Audience =
  { mode: "all" } | { mode: "match"; filter: AudienceNode };

/**
 * 每個使用處能用什麼(由呼叫端傳入,schema 依此檢查):
 *
 * | 用在哪                     | allowAll | 所屬組織可以選                                  |
 * | -------------------------- | -------- | ----------------------------------------------- |
 * | 資料範圍的套用對象         | 是       | 指定組織                                        |
 * | 流程審核者、知會、逾時通知 | 否       | 指定組織 / 表單的組織欄位 / 單據所屬組織 / 租戶 |
 * | 通知設定(負責人提醒)       | 否       | 由通知類型宣告                                  |
 */
export interface AudienceOptions {
  /** 能不能選「所有人」(只有資料範圍可以)。 */
  allowAll: boolean;
  /** 可用的欄位。 */
  fields: readonly AudienceField[];
  /** 所屬組織可用的來源(`fields` 不含 `org` 時不必給)。 */
  orgSources: readonly AudienceOrgSource[];
}

export function isAudienceGroup(node: AudienceNode): node is AudienceGroup {
  return "children" in node;
}

/** dynamic ref → 它屬於哪一種組織來源;認不得 → `undefined`。 */
export function orgSourceOfRef(ref: string): AudienceOrgSource | undefined {
  if (ref.startsWith(AUDIENCE_FORM_FIELD_REF_PREFIX)) {
    return "form-field";
  }
  return (AUDIENCE_ORG_SOURCES as readonly string[]).includes(ref) &&
    ref !== "static" &&
    ref !== "form-field"
    ? (ref as AudienceOrgSource)
    : undefined;
}
