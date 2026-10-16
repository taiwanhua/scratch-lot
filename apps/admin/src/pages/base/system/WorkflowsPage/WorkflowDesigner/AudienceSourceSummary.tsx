import { useMemo } from "react";
import { useTranslations } from "use-intl";

import type { Audience, AudienceField } from "@repo/domain/audience";
import type { FieldDef } from "@repo/domain/form";
import { isOrgReferenceField } from "@repo/domain/workflow";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Typography } from "@repo/ui/typography";

import { useAudienceSummary } from "@/components/base/AudiencePicker/useAudienceSummary";
import {
  type AudienceDraft,
  type AudienceOrgSourceOption,
  newAudienceDraft,
  toAudienceDraft,
} from "@/lib/base/audience-draft";
import { conditionFieldsOf } from "@/lib/base/form-engine/expression-options";

import { AudienceConditionDialog } from "./AudienceConditionDialog";

/** 客製流程:角色在前(最常見的「某角色且屬於某組織」),新條件列預設就是角色。 */
const CUSTOM_FIELDS: readonly AudienceField[] = [
  "role",
  "org",
  "permission",
  "user",
];

/** 共用流程:只能用權限與非指定的組織來源(`SHARED_APPROVER_AUDIENCE_OPTIONS`)。 */
const SHARED_FIELDS: readonly AudienceField[] = ["permission", "org"];

/** 對話框的起點:還沒有條件(剛換成人員條件)時先給一列,打開就能挑。 */
const initialDraftOf = (
  audience: Audience,
  fields: readonly AudienceField[],
  orgSources: readonly AudienceOrgSourceOption[],
): AudienceDraft => {
  const first = fields[0] ?? "role";
  const draft = toAudienceDraft(audience, first, orgSources);
  return draft.filter.children.length === 0
    ? newAudienceDraft(first, { allowAll: false, orgSources })
    : draft;
};

export interface AudienceSourceSummaryProps {
  audience: Audience;
  stepName: string;
  isShared: boolean;
  /** 檢查用表單的欄位:組織引用欄列成「表單的組織欄位」來源 */
  checkFormFields: readonly FieldDef[] | null;
  isDisabled: boolean;
  isDialogOpen: boolean;
  onDialogOpenChange: (isOpen: boolean) => void;
  onChange: (audience: Audience) => void;
}

/**
 * 關卡面板的「審核者」框(Figma BS-02a / c):條件摘要一行白話 + [編輯條件](開 `AudienceConditionDialog`)。
 * 所屬組織的來源依流程:客製 = 指定組織 / 單據所屬組織 / 表單的組織欄位 / 最上層組織(租戶);
 * 共用 = 去掉指定組織。表單的組織欄位來自檢查用表單的組織引用欄(非受保護欄位)。
 */
export const AudienceSourceSummary = ({
  audience,
  stepName,
  isShared,
  checkFormFields,
  isDisabled,
  isDialogOpen,
  onDialogOpenChange,
  onChange,
}: AudienceSourceSummaryProps) => {
  const t = useTranslations("admin.workflows.assignee");
  const fields = isShared ? SHARED_FIELDS : CUSTOM_FIELDS;
  const orgSources = useMemo((): AudienceOrgSourceOption[] => {
    const formFields = conditionFieldsOf(checkFormFields ?? [], null, true)
      .filter((field) => isOrgReferenceField(field))
      .map((field): AudienceOrgSourceOption => ({
        kind: "dynamic",
        ref: `form-field:${field.key}`,
        label: t("orgFormField", { field: field.label }),
      }));
    return [
      ...(isShared ? [] : [{ kind: "static" } as const]),
      { kind: "dynamic", ref: "submission-org", label: t("orgSubmission") },
      ...formFields,
      { kind: "dynamic", ref: "tenant", label: t("orgTenant") },
    ];
  }, [checkFormFields, isShared, t]);
  const summaryOf = useAudienceSummary(fields, orgSources);
  const summary = summaryOf(audience);

  return (
    <Box
      sx={{ bgcolor: "action.hover", borderRadius: 1, px: 1.5, py: 1.25 }}
      role="group"
      aria-label={t("audienceRegion")}
    >
      <Typography variant="caption" color="text.secondary" component="p">
        {t("audienceTitle")}
      </Typography>
      <Typography variant="body2" sx={{ my: 0.75 }}>
        {summary === "" ? t("audienceEmpty") : summary}
      </Typography>
      {!isDisabled && (
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            onDialogOpenChange(true);
          }}
        >
          {t("audienceEdit")}
        </Button>
      )}
      {isDialogOpen && (
        <AudienceConditionDialog
          stepName={stepName}
          isShared={isShared}
          initial={initialDraftOf(audience, fields, orgSources)}
          fields={fields}
          orgSources={orgSources}
          onCancel={() => {
            onDialogOpenChange(false);
          }}
          onApply={(next) => {
            onChange(next as unknown as Audience);
            onDialogOpenChange(false);
          }}
        />
      )}
    </Box>
  );
};
