import type {
  AudienceDynamicRef,
  AudienceField,
  AudienceOrgRange,
} from "@repo/domain/audience";

import type {
  AudienceConditionDraft,
  AudienceDraft,
  AudienceNodeDraft,
} from "./audience-draft";

/**
 * 人員條件的一行白話摘要(流程設計器關卡面板的「審核者」框):
 * 「角色 屬於 財務 且 所屬組織 屬於 【單據所屬組織】(本身)」。
 *
 * - 條件列 = 欄位 + 比較方式(屬於 / 持有)+ 值(多個用「、」);所屬組織另帶範圍
 * - 群組 = 子項以「且 / 或」接起來;巢狀群組加括號
 * - 動態組織來源用【】標出(與 AudiencePicker 的下拉同一份名稱)
 * - 名稱解不出來(清單還沒載入、看不到)由 `labels.nameOf` 自己決定退路
 */
export interface AudienceSummaryLabels {
  field: (field: AudienceField) => string;
  /** 「屬於」;權限欄是「持有」 */
  cond: (field: AudienceField) => string;
  and: string;
  or: string;
  range: (range: AudienceOrgRange) => string;
  /** 寫死的 id / 權限 key → 顯示名稱 */
  nameOf: (field: AudienceField, value: string) => string;
  dynamicOf: (ref: AudienceDynamicRef) => string;
  /** 條件列還沒挑值 */
  unset: string;
}

const leafText = (
  leaf: AudienceConditionDraft,
  labels: AudienceSummaryLabels,
): string => {
  const values =
    leaf.value.kind === "dynamic"
      ? `【${labels.dynamicOf(leaf.value.ref)}】`
      : leaf.value.values
          .map((value) => labels.nameOf(leaf.field, value))
          .join("、") || labels.unset;
  const range =
    leaf.field === "org" ? `(${labels.range(leaf.range ?? "self")})` : "";
  return `${labels.field(leaf.field)} ${labels.cond(leaf.field)} ${values}${range}`;
};

const nodeText = (
  node: AudienceNodeDraft,
  labels: AudienceSummaryLabels,
  isNested: boolean,
): string => {
  if (node.kind === "condition") {
    return leafText(node, labels);
  }
  const joiner = ` ${node.op === "AND" ? labels.and : labels.or} `;
  const text = node.children
    .map((child) => nodeText(child, labels, true))
    .join(joiner);
  return isNested && node.children.length > 1 ? `(${text})` : text;
};

/** 「符合條件」的摘要;「所有人」(審核者不會出現)回空字串,由呼叫端決定要不要顯示。 */
export const audienceSummaryOf = (
  draft: AudienceDraft,
  labels: AudienceSummaryLabels,
): string =>
  draft.mode === "all" ? "" : nodeText(draft.filter, labels, false);
