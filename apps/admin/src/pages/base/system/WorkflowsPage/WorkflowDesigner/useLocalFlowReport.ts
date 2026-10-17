import { useMemo } from "react";

import type { FieldDef } from "@repo/domain/form";
import {
  type WorkflowDefinition,
  type WorkflowValidationReport,
  isJoinStep,
  validateWorkflowDefinition,
} from "@repo/domain/workflow";

export interface LocalFlowReportInput {
  definition: WorkflowDefinition;
  isShared: boolean;
  /** 角色清單拿到了才給(拿不到就交給 api 檢查) */
  tenantRoleIds: ReadonlySet<string> | undefined;
  /** 「檢查用表單」與它目前版本的欄位(`null` = 沒選或還沒載到) */
  checkFormKey: string | null;
  checkFormFields: readonly FieldDef[] | null;
}

/**
 * `field` 來源(審核者、知會對象)要對照的表單目錄:前端只拿得到「檢查用表單」的欄位,所以只有每個 `field` 來源都指向它
 * (或還沒選表單)時才給 —— 給了目錄,目錄裡沒有的表單會被當成不存在,指到別張表單的舊資料交給 api 檢查。
 */
const formsOf = ({
  definition,
  checkFormKey,
  checkFormFields,
}: LocalFlowReportInput):
  ReadonlyMap<string, readonly FieldDef[] | null> | undefined => {
  if (checkFormKey === null || checkFormFields === null) {
    return undefined;
  }
  // 審核者與知會對象(關卡 / 整個流程)的 `field` 來源都要指向檢查用表單
  const sources = [
    ...definition.steps.flatMap((step) =>
      isJoinStep(step) ? [] : [step.assignee, step.cc ?? null],
    ),
    definition.cc ?? null,
  ];
  const isAllOnCheckForm = sources.every(
    (source) =>
      source?.kind !== "field" ||
      source.formKey === checkFormKey ||
      source.formKey === "",
  );
  return isAllOnCheckForm
    ? new Map([[checkFormKey, checkFormFields]])
    : undefined;
};

/**
 * 設計器的即時檢查(前後端同一份 `validateWorkflowDefinition`):跳過條件與「表單欄位」來源都對
 * 「檢查用表單」的目前版本驗。結構類檢查不需要表單,沒選也照跑。
 */
export const localFlowReport = (
  input: LocalFlowReportInput,
): WorkflowValidationReport => {
  const forms = formsOf(input);
  return validateWorkflowDefinition(input.definition, {
    isShared: input.isShared,
    ...(input.tenantRoleIds !== undefined && {
      tenantRoleIds: input.tenantRoleIds,
    }),
    ...(forms !== undefined && { forms }),
    ...(input.checkFormFields !== null && {
      checkFormFields: input.checkFormFields,
    }),
  });
};

export const useLocalFlowReport = ({
  definition,
  isShared,
  tenantRoleIds,
  checkFormKey,
  checkFormFields,
}: LocalFlowReportInput): WorkflowValidationReport =>
  useMemo(
    () =>
      localFlowReport({
        definition,
        isShared,
        tenantRoleIds,
        checkFormKey,
        checkFormFields,
      }),
    [definition, isShared, tenantRoleIds, checkFormKey, checkFormFields],
  );
