import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { issueKey } from "@/lib/base/data-scope-issues";
import {
  DATA_SCOPE_GROUP_OPS,
  type GroupDraft,
  type NodeDraft,
  newCondition,
  newGroup,
} from "@/lib/base/data-scope-rule";

import type { DataScopeEditorEnv } from "../data-scope-types";
import { ConditionRow } from "./ConditionRow";

/**
 * UI 呈現的巢狀上限(ADR-0008「任意深、UI 建議 3 層」):規則的根群組是第 1 層,
 * 所以 `childPath.length` 到 2 就不再給「+ 群組」。資料結構本身沒有這個限制。
 */
const MAX_DEPTH = 3;

export interface ConditionGroupProps {
  group: GroupDraft;
  ruleIndex: number;
  /** 從規則根群組往下的位置;根群組是空陣列 */
  childPath: readonly number[];
  env: DataScopeEditorEnv;
  onChange: (next: GroupDraft) => void;
  /** 根群組不可刪(它就是規則的條件樹),所以只有子群組會給 */
  onRemove?: () => void;
}

/**
 * 條件樹的一個群組(Figma 167:1738 根群組 / 167:1828 子群組):
 * 一個 AND / OR 切換 + 底下的條件列與子群組 + 「+ 條件」「+ 群組」。
 * 子群組整個被視為上一層的一個條件(註記卡 167:1901),所以有底色與縮排把括號畫出來。
 */
export const ConditionGroup = ({
  group,
  ruleIndex,
  childPath,
  env,
  onChange,
  onRemove,
}: ConditionGroupProps) => {
  const t = useTranslations("admin.dataScope.group");
  const tReasons = useTranslations("admin.dataScope.reasons");

  const isRoot = childPath.length === 0;
  const canNest = childPath.length < MAX_DEPTH - 1;
  const issue = env.issues.get(issueKey(ruleIndex, childPath, "group"));

  const replaceChild = (index: number, next: NodeDraft) => {
    onChange({
      ...group,
      children: group.children.map((child, position) =>
        position === index ? next : child,
      ),
    });
  };

  const removeChild = (index: number) => {
    onChange({
      ...group,
      children: group.children.filter((_, position) => position !== index),
    });
  };

  const append = (node: NodeDraft) => {
    onChange({ ...group, children: [...group.children, node] });
  };

  return (
    <Stack
      spacing={1.25}
      sx={
        isRoot
          ? undefined
          : {
              bgcolor: "background.default",
              borderRadius: 1,
              px: 1.75,
              py: 1.5,
            }
      }
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
        <SelectField
          size="small"
          label={isRoot ? t("rootOp") : t("nestedOp")}
          value={group.op}
          disabled={env.isReadOnly}
          sx={{ width: 240 }}
          options={DATA_SCOPE_GROUP_OPS.map((op) => ({
            value: op,
            label: op === "AND" ? t("opAnd") : t("opOr"),
          }))}
          onChange={(op) => {
            onChange({ ...group, op });
          }}
        />
        {!isRoot && (
          <Typography variant="caption" color="text.secondary">
            {t("nestedHint")}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {onRemove !== undefined && !env.isReadOnly && (
          <Button variant="text" size="small" onClick={onRemove}>
            {t("remove")}
          </Button>
        )}
      </Stack>

      {group.children.map((child, index) =>
        child.kind === "group" ? (
          <ConditionGroup
            key={`${String(index)}-group`}
            group={child}
            ruleIndex={ruleIndex}
            childPath={[...childPath, index]}
            env={env}
            onChange={(next) => {
              replaceChild(index, next);
            }}
            onRemove={() => {
              removeChild(index);
            }}
          />
        ) : (
          <ConditionRow
            key={`${String(index)}-condition`}
            condition={child}
            ruleIndex={ruleIndex}
            childPath={[...childPath, index]}
            env={env}
            onChange={(next) => {
              replaceChild(index, next);
            }}
            onRemove={() => {
              removeChild(index);
            }}
          />
        ),
      )}

      {issue !== undefined && (
        <Typography variant="caption" color="error.main">
          {tReasons(issue.reason)}
        </Typography>
      )}

      {!env.isReadOnly && env.fields.length > 0 && (
        <Stack direction="row" spacing={1}>
          <Button
            variant="text"
            size="small"
            onClick={() => {
              append(newCondition(env.fields[0]));
            }}
          >
            {t("addCondition")}
          </Button>
          {canNest && (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                append(newGroup(env.fields[0]));
              }}
            >
              {t("addGroup")}
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
};
