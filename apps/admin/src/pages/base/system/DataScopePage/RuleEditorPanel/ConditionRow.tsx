import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { issueKey } from "@/lib/base/data-scope-issues";
import {
  CONDITIONS_BY_TYPE,
  type ConditionDraft,
  newCondition,
  withCondition,
} from "@/lib/base/data-scope-rule";

import type { DataScopeEditorEnv } from "../data-scope-types";
import { ValueEditor } from "./ValueEditor";

export interface ConditionRowProps {
  condition: ConditionDraft;
  ruleIndex: number;
  /** 這一列在規則根群組底下的位置(= api `path` 的 `children[...]`,用來對上錯誤) */
  childPath: readonly number[];
  env: DataScopeEditorEnv;
  onChange: (next: ConditionDraft) => void;
  onRemove: () => void;
}

/**
 * 一條條件列(Figma 167:1746):欄位 → 條件 → 值 → 刪除,**目錄驅動** —
 * 欄位決定型別,型別決定「條件」有哪些選項與「值」長什麼樣(ADR-0008)。
 * 換欄位就整條重建(運算子與值一起重設),不留上一個型別的殘值。
 */
export const ConditionRow = ({
  condition,
  ruleIndex,
  childPath,
  env,
  onChange,
  onRemove,
}: ConditionRowProps) => {
  const t = useTranslations("admin.dataScope.condition");
  const tConditions = useTranslations("admin.dataScope.conditions");
  const tReasons = useTranslations("admin.dataScope.reasons");

  const field = env.fields.find((item) => item.name === condition.field);
  const issue =
    env.issues.get(issueKey(ruleIndex, childPath, "field")) ??
    env.issues.get(issueKey(ruleIndex, childPath, "cond")) ??
    env.issues.get(issueKey(ruleIndex, childPath, "value"));

  const fieldSelect = (
    <SelectField
      size="small"
      label={t("field")}
      value={field === undefined ? "" : condition.field}
      error={issue?.target === "field"}
      disabled={env.isReadOnly}
      sx={{ width: 190 }}
      options={env.fields.map((item) => ({
        value: item.name,
        label: item.label,
      }))}
      onChange={(name) => {
        const next = env.fields.find((item) => item.name === name);
        if (next !== undefined) {
          onChange(newCondition(next));
        }
      }}
    />
  );

  const removeButton = env.isReadOnly ? null : (
    <Button variant="text" size="small" onClick={onRemove}>
      {t("remove")}
    </Button>
  );

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
        {fieldSelect}
        {field !== undefined && (
          <>
            <SelectField
              size="small"
              label={t("cond")}
              value={condition.cond}
              error={issue?.target === "cond"}
              disabled={env.isReadOnly}
              sx={{ width: 150 }}
              options={CONDITIONS_BY_TYPE[field.type].map((cond) => ({
                value: cond,
                label: tConditions(cond),
              }))}
              onChange={(cond) => {
                onChange(withCondition(condition, cond, field.type));
              }}
            />
            <ValueEditor
              field={field}
              condition={condition}
              env={env}
              hasError={issue?.target === "value"}
              onChange={(value) => {
                onChange({ ...condition, value });
              }}
            />
          </>
        )}
        <Box sx={{ flex: 1 }} />
        {removeButton}
      </Stack>
      {issue !== undefined && (
        <Typography variant="caption" color="error.main">
          {tReasons(issue.reason)}
        </Typography>
      )}
    </Stack>
  );
};
