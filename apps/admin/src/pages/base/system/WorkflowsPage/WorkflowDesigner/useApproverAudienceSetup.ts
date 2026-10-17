import { useMemo } from "react";
import { useTranslations } from "use-intl";

import type { Audience, AudienceField } from "@repo/domain/audience";
import type { FieldDef } from "@repo/domain/form";
import { isOrgReferenceField } from "@repo/domain/workflow";

import {
  type AudienceDraft,
  type AudienceOrgSourceOption,
  newAudienceDraft,
  toAudienceDraft,
} from "@/lib/base/audience-draft";
import { conditionFieldsOf } from "@/lib/base/form-engine/expression-options";

/** 客製流程:角色在前(最常見的「某角色且屬於某組織」),新條件列預設就是角色。 */
const CUSTOM_FIELDS: readonly AudienceField[] = [
  "role",
  "org",
  "permission",
  "user",
];

/** 共用流程:只能用權限與非指定的組織來源(`SHARED_APPROVER_AUDIENCE_OPTIONS`)。 */
const SHARED_FIELDS: readonly AudienceField[] = ["permission", "org"];

export interface ApproverAudienceSetup {
  fields: readonly AudienceField[];
  orgSources: readonly AudienceOrgSourceOption[];
  /** 條件對話框的起點:還沒有條件(剛換成人員條件)時先給一列,打開就能挑 */
  initialDraftOf: (audience: Audience | null) => AudienceDraft;
}

/**
 * 審核者「人員條件」在設計器裡可用的欄位與所屬組織來源(摘要框與條件對話框共用):
 * 客製 = 指定組織 / 單據所屬組織 / 表單的組織欄位 / 最上層組織(租戶);共用 = 去掉指定組織、欄位只有權限與所屬組織。
 * 表單的組織欄位來自檢查用表單的組織引用欄(非受保護欄位)。
 */
export const useApproverAudienceSetup = (
  isShared: boolean,
  checkFormFields: readonly FieldDef[] | null,
): ApproverAudienceSetup => {
  const t = useTranslations("admin.workflows.assignee");
  return useMemo(() => {
    const fields = isShared ? SHARED_FIELDS : CUSTOM_FIELDS;
    const formFields = conditionFieldsOf(checkFormFields ?? [], null, true)
      .filter((field) => isOrgReferenceField(field))
      .map((field): AudienceOrgSourceOption => ({
        kind: "dynamic",
        ref: `form-field:${field.key}`,
        label: t("orgFormField", { field: field.label }),
      }));
    const orgSources: AudienceOrgSourceOption[] = [
      ...(isShared ? [] : [{ kind: "static" } as const]),
      { kind: "dynamic", ref: "submission-org", label: t("orgSubmission") },
      ...formFields,
      { kind: "dynamic", ref: "tenant", label: t("orgTenant") },
    ];
    const first = fields[0] ?? "role";
    return {
      fields,
      orgSources,
      initialDraftOf: (audience) => {
        const draft = toAudienceDraft(audience, first, orgSources);
        return draft.filter.children.length === 0
          ? newAudienceDraft(first, { allowAll: false, orgSources })
          : draft;
      },
    };
  }, [checkFormFields, isShared, t]);
};
