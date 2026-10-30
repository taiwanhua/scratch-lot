import { useState } from "react";
import { useTranslations } from "use-intl";

import type { FieldDef } from "@repo/domain/form";
import {
  type ReviewStepDef,
  SKIP_ORG_TENANT,
  type SkipOrgsDef,
} from "@repo/domain/workflow";
import { Box } from "@repo/ui/box";
import { Checkbox } from "@repo/ui/checkbox";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { JsonPreview } from "@/components/base/JsonPreview";
import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { ExpressionPicker } from "@/components/base/form-engine/ExpressionPicker/ExpressionPicker";
import { conditionFieldsOf } from "@/lib/base/form-engine/expression-options";

export interface StepSkipSectionProps {
  step: ReviewStepDef;
  onChange: (next: ReviewStepDef) => void;
  /** 共用流程:「申請人屬於這些組織」只能選最上層組織 */
  isShared: boolean;
  /** 「檢查用表單」與它目前版本的欄位;「符合跳過條件」(跳過條件公式)的欄位選項來自它 */
  checkFormKey: string | null;
  checkFormFields: readonly FieldDef[] | null;
  isReadonly: boolean;
}

/** 勾「申請人屬於這些組織」時的起點:最上層組織、不含下層。 */
const DEFAULT_SKIP_ORGS: SkipOrgsDef = {
  orgIds: [SKIP_ORG_TENANT],
  includeDescendants: false,
};

/** 欄位下拉沒東西可選時說明為什麼:沒選檢查用表單 / 表單還在載入 / 選了但沒有可用欄位。 */
const emptyFieldsReasonOf = (
  checkFormKey: string | null,
  checkFormFields: readonly FieldDef[] | null,
  usableCount: number,
): "needsCheckForm" | "checkFormLoading" | "noUsableFields" | null => {
  if (checkFormKey === null) {
    return "needsCheckForm";
  }
  if (checkFormFields === null) {
    return "checkFormLoading";
  }
  return usableCount === 0 ? "noUsableFields" : null;
};

/** 最上層組織排在前面,其餘照選取順序。 */
const orgIdsOf = (hasTenant: boolean, specific: readonly string[]): string[] =>
  hasTenant ? [SKIP_ORG_TENANT, ...specific] : [...specific];

/**
 * 關卡面板「跳過這一關(符合任一項就跳過)」區塊:
 * - ☑ 申請人屬於這些組織(`skipOrgs`):最上層組織(特殊值 `SKIP_ORG_TENANT`)/ 指定組織(客製流程才有)+ 包含下層。
 *   共用流程只能選最上層組織:不給組織樹,最上層組織固定勾著。
 * - ☑ 符合跳過條件(`skipWhen`,跳過條件公式,原本單獨的欄位搬進來,格式不變):6a 表達式選擇器,欄位來自檢查用表單。
 *
 * 兩項各自勾選,任一項成立就跳過;都不勾 = 不跳過。取消勾選就清掉那一項的設定。
 * 「符合跳過條件」勾了但還沒設公式時不存東西(存檔後重新載入 = 沒勾)。
 */
export const StepSkipSection = ({
  step,
  onChange,
  isShared,
  checkFormKey,
  checkFormFields,
  isReadonly,
}: StepSkipSectionProps) => {
  const t = useTranslations("admin.workflows.step");
  const hasCondition = step.skipWhen !== undefined && step.skipWhen !== null;
  const [isConditionOn, setIsConditionOn] = useState(hasCondition);
  const skipOrgs = step.skipOrgs ?? null;
  const hasTenant = skipOrgs?.orgIds.includes(SKIP_ORG_TENANT) ?? false;
  const specific =
    skipOrgs?.orgIds.filter((id) => id !== SKIP_ORG_TENANT) ?? [];
  const skipFields = conditionFieldsOf(checkFormFields ?? [], null, true);
  const emptyReason = emptyFieldsReasonOf(
    checkFormKey,
    checkFormFields,
    skipFields.length,
  );
  const emptyFieldsLabel = emptyReason === null ? undefined : t(emptyReason);
  const setSkipOrgs = (next: SkipOrgsDef | null) => {
    onChange({ ...step, skipOrgs: next });
  };

  return (
    <Stack
      spacing={0.5}
      role="group"
      aria-label={t("skip.title")}
      sx={{ bgcolor: "action.hover", borderRadius: 1, px: 1.5, py: 1.25 }}
    >
      <Typography variant="subtitle2" component="h3">
        {t("skip.title")}
      </Typography>
      <FormControlLabel
        label={t("skip.orgs")}
        control={
          <Checkbox
            checked={skipOrgs !== null}
            disabled={isReadonly}
            onChange={(_event, checked) => {
              setSkipOrgs(checked ? DEFAULT_SKIP_ORGS : null);
            }}
          />
        }
      />
      {skipOrgs !== null && (
        <Stack spacing={0.5} sx={{ pl: 4 }}>
          {!isShared && (
            <Box sx={{ pt: 0.5 }}>
              <OrgTreeSelect
                label={t("skip.orgsPick")}
                value={specific}
                isMultiSelect
                size="small"
                fullWidth
                disabled={isReadonly}
                onChange={(ids) => {
                  setSkipOrgs({
                    ...skipOrgs,
                    orgIds: orgIdsOf(hasTenant, ids),
                  });
                }}
              />
            </Box>
          )}
          <Stack direction="row" sx={{ flexWrap: "wrap" }}>
            <FormControlLabel
              label={t("skip.tenant")}
              control={
                <Checkbox
                  checked={hasTenant}
                  // 共用流程只有最上層組織可選:固定勾著
                  disabled={isReadonly || (isShared && hasTenant)}
                  onChange={(_event, checked) => {
                    setSkipOrgs({
                      ...skipOrgs,
                      orgIds: orgIdsOf(checked, specific),
                    });
                  }}
                />
              }
            />
            <FormControlLabel
              label={t("skip.includeDescendants")}
              control={
                <Checkbox
                  checked={skipOrgs.includeDescendants}
                  disabled={isReadonly}
                  onChange={(_event, includeDescendants) => {
                    setSkipOrgs({ ...skipOrgs, includeDescendants });
                  }}
                />
              }
            />
          </Stack>
          <Typography variant="caption" color="textSecondary">
            {isShared ? t("skip.sharedOrgsHint") : t("skip.orgsHint")}
          </Typography>
        </Stack>
      )}
      <FormControlLabel
        label={t("skip.condition")}
        control={
          <Checkbox
            checked={isConditionOn}
            disabled={isReadonly}
            onChange={(_event, checked) => {
              setIsConditionOn(checked);
              if (!checked) {
                onChange({ ...step, skipWhen: null });
              }
            }}
          />
        }
      />
      {isConditionOn && (
        <Stack spacing={0.5} sx={{ pl: 4 }}>
          {/* 唯讀時勾選狀態 = 有沒有公式(改不了),勾著就一定有公式 */}
          {isReadonly ? (
            <JsonPreview value={step.skipWhen} label={t("skip.condition")} />
          ) : (
            <>
              {checkFormKey === null && (
                <Typography variant="caption" color="textSecondary">
                  {t("skipNeedsCheckForm")}
                </Typography>
              )}
              <ExpressionPicker
                label={t("skip.condition")}
                value={step.skipWhen ?? undefined}
                fields={skipFields}
                usage="condition"
                formKey={checkFormKey ?? ""}
                {...(emptyFieldsLabel !== undefined && { emptyFieldsLabel })}
                onChange={(skipWhen) => {
                  onChange({ ...step, skipWhen });
                }}
              />
            </>
          )}
        </Stack>
      )}
    </Stack>
  );
};
