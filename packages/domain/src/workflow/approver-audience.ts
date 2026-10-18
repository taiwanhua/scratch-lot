import {
  AUDIENCE_FIELDS,
  AUDIENCE_FORM_FIELD_REF_PREFIX,
  type Audience,
  type AudienceLeaf,
  type AudienceNode,
  type AudienceOptions,
  isAudienceGroup,
} from "../audience/types";

/**
 * 審核者來源「人員條件」的使用處規則:
 *
 * | 流程     | 欄位                         | 所屬組織可以選                                  |
 * | -------- | ---------------------------- | ----------------------------------------------- |
 * | 租戶客製 | 使用者、角色、所屬組織、權限 | 指定組織 / 表單的組織欄位 / 單據所屬組織 / 租戶 |
 * | 共用     | 所屬組織、權限               | 表單的組織欄位 / 單據所屬組織 / 租戶            |
 *
 * 格式檢查一律用客製的選項(`APPROVER_AUDIENCE_OPTIONS`,錯 → `AUDIENCE_INVALID`);共用流程再以
 * `sharedAudienceViolations` 找出不能用的條件列(→ `AUDIENCE_IN_SHARED`),兩種錯分開報,
 * 設計者才看得出是「寫錯」還是「共用流程不能這樣寫」。審核者一定要設條件(不能選「所有人」)。
 */
export const APPROVER_AUDIENCE_OPTIONS: AudienceOptions = {
  allowAll: false,
  fields: AUDIENCE_FIELDS,
  orgSources: ["static", "form-field", "submission-org", "tenant"],
};

/** 共用流程的人員條件:只能用權限與非指定的組織來源(AudiencePicker 依此只列可用的選項)。 */
export const SHARED_APPROVER_AUDIENCE_OPTIONS: AudienceOptions = {
  allowAll: false,
  fields: ["org", "permission"],
  orgSources: ["form-field", "submission-org", "tenant"],
};

/** 條件樹的一個條件列與它從人員條件根算起的路徑(同 `validateAudience` 的 `path` 寫法)。 */
export interface AudienceLeafAt {
  leaf: AudienceLeaf;
  path: string;
}

/** 依序列出條件樹裡所有條件列(深度優先;形狀不對的節點略過,格式錯由 `validateAudience` 報)。 */
export function audienceLeavesOf(audience: Audience): AudienceLeafAt[] {
  if (audience.mode !== "match") {
    return [];
  }
  const leaves: AudienceLeafAt[] = [];
  const walk = (node: AudienceNode, path: string): void => {
    if (isAudienceGroup(node)) {
      for (const [index, child] of node.children.entries()) {
        walk(child, `${path}.children[${String(index)}]`);
      }
      return;
    }
    leaves.push({ leaf: node, path });
  };
  walk(audience.filter, "filter");
  return leaves;
}

/** 共用流程不能用的條件列:使用者、角色、指定組織。 */
export function sharedAudienceViolations(audience: Audience): AudienceLeafAt[] {
  return audienceLeavesOf(audience).filter(
    ({ leaf }) =>
      leaf.field === "user" ||
      leaf.field === "role" ||
      (leaf.field === "org" && leaf.value.kind === "static"),
  );
}

/** 某欄位(使用者 / 角色 / 所屬組織)條件列裡寫死的 id(去重)。 */
export function audienceStaticIdsOf(
  audience: Audience,
  field: "user" | "role" | "org",
): string[] {
  return [
    ...new Set(
      audienceLeavesOf(audience).flatMap(({ leaf }) =>
        leaf.field === field && leaf.value.kind === "static"
          ? leaf.value.values
          : [],
      ),
    ),
  ];
}

/** 條件列引用的表單組織欄位(`form-field:<key>`)與位置。 */
export function audienceFormFieldRefsOf(
  audience: Audience,
): { fieldKey: string; path: string }[] {
  return audienceLeavesOf(audience).flatMap(({ leaf, path }) =>
    leaf.value.kind === "dynamic" &&
    leaf.value.ref.startsWith(AUDIENCE_FORM_FIELD_REF_PREFIX)
      ? [
          {
            fieldKey: leaf.value.ref.slice(
              AUDIENCE_FORM_FIELD_REF_PREFIX.length,
            ),
            path: `${path}.value.ref`,
          },
        ]
      : [],
  );
}
