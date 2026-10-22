import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import { scheduleRuleDefinitionOf } from "@repo/domain/project/schedule-settings";
import {
  ScheduleRuleSource,
  type ScheduleRulesFieldsFragment,
  useCustomizeScheduleAutoRunMutation,
  useCustomizeScheduleRuleMutation,
  useRestoreScheduleRuleMutation,
  useScheduleDemandWeekTemplatesQuery,
  useScheduleRulesQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";

import { scheduleErrorKey, scheduleErrorOf } from "../../schedule-error";
import { AutoRunDialog } from "./AutoRunDialog";
import { RuleDialog, type RuleDialogSave } from "./RuleDialog";
import { RuleRow } from "./RuleRow";
import {
  type RuleLookups,
  type RuleTranslate,
  ruleParentText,
  ruleSourceText,
  ruleSummaryText,
} from "./rule-display";

type Rules = ScheduleRulesFieldsFragment;
type Rule = Rules["items"][number];

/** `?org=`:規則頁看的組織;空字串 = 當前組織。 */
const orgSchema = z.string().default("");

/**
 * 排班設定 → 規則(SC-10;規格 14.2):一條規則一列、依規格表的順序;自動排班條件整組列在最下面。
 *
 * - 每列:規則名稱、值(自訂時下方灰色小字「上層:8 天」)、等級(有等級的規則)、
 *   來源(沿用:<上層組織> / 本店自訂 / 看不到上層時「沿用上層設定」)、[自訂] 或 [還原]
 * - 點一列 → 規則編輯對話框(SC-27);能不能改由 api 算好的 `canEdit` 決定
 *   (最上層組織看 `edit-default-rules`、其他看 `edit-org-rules`;沒有時看不到 [自訂] [還原])
 * - 分店選擇器(底座 `OrgTreeSelect`)放網址參數
 */
export const RulesTab = () => {
  const t = useTranslations("admin.schedule.rules");
  const tErrors = useTranslations("admin.schedule.errors");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [orgId, setOrgId] = useUrlState("org", orgSchema);
  const tasks = useScheduleFieldOptions(SCHEDULE_FIELD_CATEGORY_KEYS.task);
  const variables = { input: orgId === "" ? null : { orgId } };
  // 週範本跟著規則看的那家店(那家店的組織鏈上建立的),不是當前組織
  const weekTemplates = useScheduleDemandWeekTemplatesQuery(
    session.client,
    variables,
  );
  const query = useScheduleRulesQuery(session.client, variables);
  const rules = query.data?.scheduleRules;
  const [editing, setEditing] = useState<Rule | null>(null);
  const [isEditingAutoRun, setIsEditingAutoRun] = useState(false);

  const weekTemplateItems = (
    weekTemplates.data?.scheduleDemandWeekTemplates.items ?? []
  ).filter((week) => week.enabled);
  const lookups: RuleLookups = {
    weekTemplateName: (id) =>
      weekTemplateItems.find((week) => week.id === id)?.name ?? null,
    taskLabel: tasks.labelOf,
  };
  const translate: RuleTranslate = (key, values) => t(key, values);

  const write = (next: Rules) => {
    queryClient.setQueryData(useScheduleRulesQuery.getKey(variables), {
      scheduleRules: next,
    });
    setEditing(null);
    setIsEditingAutoRun(false);
  };
  const error = (cause: unknown) => tErrors(scheduleErrorKey(cause));
  const customize = useCustomizeScheduleRuleMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.saveSuccess"),
      error,
      onSuccess: (data) => {
        write(data.customizeScheduleRule.rules);
      },
    }),
  );
  const customizeAutoRun = useCustomizeScheduleAutoRunMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.saveSuccess"),
      error,
      onSuccess: (data) => {
        write(data.customizeScheduleAutoRun.rules);
      },
    }),
  );
  const restore = useRestoreScheduleRuleMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.restoreSuccess"),
      error,
      onSuccess: (data) => {
        write(data.restoreScheduleRule.rules);
      },
    }),
  );
  const isPending =
    customize.isPending || customizeAutoRun.isPending || restore.isPending;

  if (rules === undefined) {
    return (
      <Typography color="textSecondary">
        {query.isError ? tErrors(scheduleErrorOf(query.error).code) : null}
      </Typography>
    );
  }

  const orgInput = { orgId: rules.orgId };
  const ruleItems = rules.items.filter((item) => item.group === "rule");
  const autoRunItems = rules.items
    .filter((item) => item.group === "autoRun")
    .toSorted((left, right) => left.effective.order - right.effective.order);
  const autoRunSource = autoRunItems.at(0)?.effective;
  const isAutoRunOwn = autoRunSource?.source === ScheduleRuleSource.Own;
  const labelOf = (key: string) => t(`labels.${key}`);

  const summaryOf = (rule: Rule) => {
    const summary = ruleSummaryText(
      translate,
      rule,
      rule.effective,
      rules.isTenantTop,
      lookups,
    );
    return rule.parent
      ? `${summary} · ${ruleParentText(translate, rule, rule.parent, lookups)}`
      : summary;
  };

  const editingDefinition =
    editing === null ? undefined : scheduleRuleDefinitionOf(editing.key);

  return (
    <Stack spacing={2}>
      <OrgTreeSelect
        // 業務頁:可見範圍內的才能選(用法表 ④)
        scope="visible"
        label={t("org")}
        value={[rules.orgId]}
        size="small"
        onChange={(ids) => {
          setOrgId(ids.at(0) ?? "");
        }}
      />
      <Card variant="outlined">
        {ruleItems.map((rule) => (
          <RuleRow
            key={rule.key}
            rule={rule}
            label={labelOf(rule.key)}
            isTenantTop={rules.isTenantTop}
            canEdit={rules.canEdit}
            isPending={isPending}
            lookups={lookups}
            onOpen={() => {
              setEditing(rule);
            }}
            onRestore={() => {
              restore.mutate({ input: { ...orgInput, key: rule.key } });
            }}
          />
        ))}
      </Card>
      <Card variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            {t("autoRunTitle")}
          </Typography>
          {autoRunSource !== undefined && (
            <Typography variant="body2" color="textSecondary">
              {ruleSourceText(translate, autoRunSource, rules.isTenantTop)}
            </Typography>
          )}
          {rules.canEdit && (
            <Button
              variant="text"
              size="small"
              disabled={isPending}
              onClick={() => {
                if (isAutoRunOwn) {
                  restore.mutate({
                    input: { ...orgInput, key: autoRunItems[0]?.key ?? "" },
                  });
                } else {
                  setIsEditingAutoRun(true);
                }
              }}
            >
              {isAutoRunOwn ? t("restore") : t("customize")}
            </Button>
          )}
        </Stack>
        <Typography
          variant="body2"
          sx={{ mt: 1, cursor: "pointer" }}
          onClick={() => {
            setIsEditingAutoRun(true);
          }}
        >
          {autoRunItems
            .map((item, index) =>
              t("autoRunItem", {
                index: index + 1,
                label: labelOf(item.key),
                unchecked: item.effective.enabled ? "" : t("autoRunUnchecked"),
              }),
            )
            .join(t("autoRunSeparator"))}
        </Typography>
      </Card>
      {editing !== null && editingDefinition !== undefined && (
        <RuleDialog
          rule={editing}
          definition={editingDefinition}
          label={labelOf(editing.key)}
          currentText={summaryOf(editing)}
          canEdit={rules.canEdit}
          isPending={isPending}
          weekTemplates={weekTemplateItems}
          taskOptions={tasks.options}
          onSave={(save: RuleDialogSave) => {
            customize.mutate({
              input: {
                ...orgInput,
                key: editing.key,
                enabled: save.enabled,
                value: save.value,
                order: save.order,
                ...(save.level === null ? {} : { level: save.level }),
              },
            });
          }}
          onRestore={() => {
            restore.mutate({ input: { ...orgInput, key: editing.key } });
          }}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {isEditingAutoRun && (
        <AutoRunDialog
          conditions={autoRunItems.map((item) => ({
            key: item.key,
            label: labelOf(item.key),
            enabled: item.effective.enabled,
          }))}
          isOwn={isAutoRunOwn}
          canEdit={rules.canEdit}
          isPending={isPending}
          onSave={(conditions) => {
            customizeAutoRun.mutate({
              input: {
                ...orgInput,
                conditions: conditions.map(({ key, enabled }) => ({
                  key,
                  enabled,
                })),
              },
            });
          }}
          onRestore={() => {
            restore.mutate({
              input: { ...orgInput, key: autoRunItems[0]?.key ?? "" },
            });
          }}
          onClose={() => {
            setIsEditingAutoRun(false);
          }}
        />
      )}
    </Stack>
  );
};
