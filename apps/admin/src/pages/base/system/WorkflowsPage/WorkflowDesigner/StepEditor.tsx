import { useTranslations } from "use-intl";

import type { FieldDef } from "@repo/domain/form";
import {
  APPROVAL_MODES,
  type ApprovalMode,
  type ReviewStepDef,
  type WorkflowIssue,
} from "@repo/domain/workflow";
import { Button } from "@repo/ui/button";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Switch } from "@repo/ui/switch";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import type { DropTarget } from "@/lib/base/workflow/flow-ops";

import { AssigneeSourcePicker } from "./AssigneeSourcePicker";
import { PeopleCcSection } from "./PeopleCcSection";
import { StepAutoApproveSection } from "./StepAutoApproveSection";
import { StepOverdueSection } from "./StepOverdueSection";
import { StepSkipSection } from "./StepSkipSection";
import type { CatalogForm } from "./useDesignerCatalog";

export interface MoveOption {
  value: string;
  label: string;
  target: DropTarget;
}

export interface StepEditorProps {
  step: ReviewStepDef;
  onChange: (next: ReviewStepDef) => void;
  /** 已發布過的關卡 key 不能改(實例、任務、歷程都靠它找回關卡) */
  isKeyLocked: boolean;
  isShared: boolean;
  forms: readonly CatalogForm[];
  /** 「檢查用表單」與它目前版本的欄位;跳過條件與「表單欄位」來源的欄位選項來自它 */
  checkFormKey: string | null;
  checkFormFields: readonly FieldDef[] | null;
  /** 唯讀檢視舊版本:看得到、改不了,也沒有關卡操作 */
  isReadonly?: boolean;
  /** 這一關的檢查器錯誤 / 警告(逾時提醒的時數錯誤另外標在欄位上) */
  issues: readonly WorkflowIssue[];
  /** 主線上、還沒分流過的關卡才能「從此關分流」 */
  canFork: boolean;
  /** 在分支裡的關卡可以「多加一條分支」 */
  canAddBranch: boolean;
  moveOptions: readonly MoveOption[];
  onInsertAfter: () => void;
  onFork: () => void;
  onAddBranch: () => void;
  onShift: (delta: -1 | 1) => void;
  onMove: (target: DropTarget) => void;
  onDelete: () => void;
}

/** 逾時提醒的時數錯誤(`OVERDUE_INVALID`):標在時數欄位上,設計器擋存草稿。 */
const isOverdueHoursIssue = (issue: WorkflowIssue): boolean =>
  issue.code === "OVERDUE_INVALID";

/**
 * 審核關卡的屬性面板(`<StepEditor>`):名稱、key、審核者來源(三種)、
 * 會簽、允許退回;「跳過這一關」(申請人屬於這些組織 / 符合條件)、自動通過、逾時提醒、知會;
 * 以及加關卡 / 從此關分流 / 移動 / 刪除。移動也有按鈕版(上移、下移、移到某條分支),拖拉之外鍵盤也做得到。
 * 呼叫端以關卡 key 當 `key` 掛載(換關卡 = 重掛,區塊內的勾選狀態不帶到別關)。
 */
export const StepEditor = ({
  step,
  onChange,
  isKeyLocked,
  isShared,
  forms,
  checkFormKey,
  checkFormFields,
  isReadonly = false,
  issues,
  canFork,
  canAddBranch,
  moveOptions,
  onInsertAfter,
  onFork,
  onAddBranch,
  onShift,
  onMove,
  onDelete,
}: StepEditorProps) => {
  const t = useTranslations("admin.workflows.step");
  const messages = [
    ...new Set(
      issues
        .filter((issue) => !isOverdueHoursIssue(issue))
        .map((issue) => issue.message),
    ),
  ];

  return (
    <Stack
      spacing={2}
      component="section"
      aria-label={t("region", { name: step.name })}
    >
      <Typography variant="subtitle1" component="h2">
        {t("title")}
      </Typography>
      <TextField
        label={t("name")}
        value={step.name}
        size="small"
        disabled={isReadonly}
        onChange={(event) => {
          onChange({ ...step, name: event.target.value });
        }}
      />
      <TextField
        label={t("key")}
        value={step.key}
        size="small"
        disabled={isKeyLocked || isReadonly}
        helperText={isKeyLocked ? t("keyLocked") : t("keyHint")}
        onChange={(event) => {
          onChange({ ...step, key: event.target.value });
        }}
      />
      <AssigneeSourcePicker
        purpose="approver"
        value={step.assignee}
        onChange={(assignee) => {
          if (assignee !== null) {
            onChange({ ...step, assignee });
          }
        }}
        stepName={step.name}
        isShared={isShared}
        forms={forms}
        checkFormKey={checkFormKey}
        checkFormFields={checkFormFields}
        isDisabled={isReadonly}
      />
      <SelectField<ApprovalMode>
        label={t("mode")}
        value={step.mode}
        size="small"
        disabled={isReadonly}
        helperText={t(`modeHints.${step.mode}`)}
        options={APPROVAL_MODES.map((mode) => ({
          value: mode,
          label: t(`modes.${mode}`),
        }))}
        onChange={(mode) => {
          onChange({ ...step, mode });
        }}
      />
      <FormControlLabel
        label={t("allowReturn")}
        control={
          <Switch
            checked={step.allowReturn !== false}
            disabled={isReadonly}
            onChange={(_event, allowReturn) => {
              onChange({ ...step, allowReturn });
            }}
          />
        }
      />
      <StepSkipSection
        step={step}
        onChange={onChange}
        isShared={isShared}
        checkFormKey={checkFormKey}
        checkFormFields={checkFormFields}
        isReadonly={isReadonly}
      />
      <StepAutoApproveSection
        step={step}
        onChange={onChange}
        isReadonly={isReadonly}
      />
      <StepOverdueSection
        step={step}
        onChange={onChange}
        isShared={isShared}
        checkFormFields={checkFormFields}
        hasHoursError={issues.some((issue) => isOverdueHoursIssue(issue))}
        isReadonly={isReadonly}
      />
      <PeopleCcSection
        title={t("cc.title")}
        hint={t("cc.hint")}
        value={step.cc ?? null}
        onChange={(cc) => {
          onChange({ ...step, cc });
        }}
        stepName={step.name}
        isShared={isShared}
        forms={forms}
        checkFormKey={checkFormKey}
        checkFormFields={checkFormFields}
        isReadonly={isReadonly}
      />
      {messages.map((message) => (
        <Typography key={message} variant="caption" color="error">
          {message}
        </Typography>
      ))}
      {!isReadonly && (
        <Stack spacing={1} role="group" aria-label={t("actions")}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button size="small" variant="outlined" onClick={onInsertAfter}>
              {t("insertAfter")}
            </Button>
            {canFork && (
              <Button size="small" variant="outlined" onClick={onFork}>
                {t("fork")}
              </Button>
            )}
            {canAddBranch && (
              <Button size="small" variant="outlined" onClick={onAddBranch}>
                {t("addBranch")}
              </Button>
            )}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                onShift(-1);
              }}
            >
              {t("moveUp")}
            </Button>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                onShift(1);
              }}
            >
              {t("moveDown")}
            </Button>
            <Button
              size="small"
              variant="text"
              color="error"
              onClick={onDelete}
            >
              {t("delete")}
            </Button>
          </Stack>
          {moveOptions.length > 0 && (
            <SelectField
              label={t("moveTo")}
              value=""
              displayEmpty
              size="small"
              options={[
                { value: "", label: t("moveToPlaceholder") },
                ...moveOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                })),
              ]}
              onChange={(value) => {
                const option = moveOptions.find((item) => item.value === value);
                if (option !== undefined) {
                  onMove(option.target);
                }
              }}
            />
          )}
        </Stack>
      )}
    </Stack>
  );
};
