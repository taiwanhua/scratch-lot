import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  CONDITION_GROUP_OPS,
  type ConditionLeaf,
  type ConditionTreeGroup,
  type ConditionTreeNode,
  canAddGroupAt,
  groupOf,
} from "@/lib/base/condition-tree";

/** 條件列的換值 / 刪除(由群組代為接回樹上)。 */
export interface ConditionHandlers<L extends ConditionLeaf> {
  onChange: (next: L) => void;
  onRemove: () => void;
}

export interface ConditionGroupProps<L extends ConditionLeaf> {
  group: ConditionTreeGroup<L>;
  /** 從根群組往下的位置;根群組是空陣列 */
  childPath: readonly number[];
  isReadOnly: boolean;
  /** 一條條件列長什麼樣由使用處決定(資料範圍的條件組合 / 人員條件),樹的骨架共用 */
  renderCondition: (
    condition: L,
    childPath: readonly number[],
    handlers: ConditionHandlers<L>,
  ) => ReactNode;
  /** 「+ 條件」「+ 群組」新增的那一列;`undefined` = 沒有欄位可選,不給新增 */
  createCondition?: () => L;
  /** 這個群組自己的錯誤文字(空群組等) */
  errorOf?: (childPath: readonly number[]) => string | undefined;
  onChange: (next: ConditionTreeGroup<L>) => void;
  /** 根群組不可刪(它就是整棵樹),所以只有子群組會給 */
  onRemove?: () => void;
}

/**
 * 條件樹的一個群組(資料範圍的條件組合與 AudiencePicker 共用;Figma `Draft/AudiencePicker`、
 * `Draft/DataScopeRuleCard`):一個 AND / OR 切換 + 底下的條件列與子群組 + 「+ 條件」「+ 群組」。
 *
 * - 根層下拉叫「組合」、巢狀群組叫「群組組合」;子群組整個被視為上一層的一個條件,
 *   所以根群組是 `bg/default` 底、巢狀群組是 `bg/paper` + 外框,把括號畫出來。
 * - UI 上限三層(`CONDITION_TREE_MAX_DEPTH`):第三層的群組不再給「+ 群組」。
 * - 新群組一定帶一條條件列(空群組不合法,不讓它先出現在畫面上)。
 */
export const ConditionGroup = <L extends ConditionLeaf>({
  group,
  childPath,
  isReadOnly,
  renderCondition,
  createCondition,
  errorOf,
  onChange,
  onRemove,
}: ConditionGroupProps<L>) => {
  const t = useTranslations("admin.conditionTree");

  const isRoot = childPath.length === 0;
  const error = errorOf?.(childPath);

  const replaceChild = (index: number, next: ConditionTreeNode<L>) => {
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

  const append = (node: ConditionTreeNode<L>) => {
    onChange({ ...group, children: [...group.children, node] });
  };

  return (
    <Stack
      spacing={1.25}
      sx={{
        bgcolor: isRoot ? "background.default" : "background.paper",
        border: isRoot ? 0 : 1,
        borderColor: "divider",
        borderRadius: 1,
        px: 1.75,
        py: 1.5,
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
        <SelectField
          size="small"
          label={isRoot ? t("rootOp") : t("nestedOp")}
          value={group.op}
          disabled={isReadOnly}
          sx={{ width: 240 }}
          options={CONDITION_GROUP_OPS.map((op) => ({
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
        {onRemove !== undefined && !isReadOnly && (
          <Button variant="text" size="small" onClick={onRemove}>
            {t("removeGroup")}
          </Button>
        )}
      </Stack>

      {group.children.map((child, index) =>
        child.kind === "group" ? (
          <ConditionGroup
            key={`${String(index)}-group`}
            group={child}
            childPath={[...childPath, index]}
            isReadOnly={isReadOnly}
            renderCondition={renderCondition}
            createCondition={createCondition}
            errorOf={errorOf}
            onChange={(next) => {
              replaceChild(index, next);
            }}
            onRemove={() => {
              removeChild(index);
            }}
          />
        ) : (
          <Box key={`${String(index)}-condition`}>
            {renderCondition(child, [...childPath, index], {
              onChange: (next) => {
                replaceChild(index, next);
              },
              onRemove: () => {
                removeChild(index);
              },
            })}
          </Box>
        ),
      )}

      {error !== undefined && (
        <Typography variant="caption" color="error.main">
          {error}
        </Typography>
      )}

      {!isReadOnly && createCondition !== undefined && (
        <Stack direction="row" spacing={1}>
          <Button
            variant="text"
            size="small"
            onClick={() => {
              append(createCondition());
            }}
          >
            {t("addCondition")}
          </Button>
          {canAddGroupAt(childPath) && (
            <Button
              variant="text"
              size="small"
              onClick={() => {
                append(groupOf(createCondition()));
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
