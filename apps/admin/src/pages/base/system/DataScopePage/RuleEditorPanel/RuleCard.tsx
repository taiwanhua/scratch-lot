import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { AudiencePicker } from "@/components/base/AudiencePicker/AudiencePicker";
import { ConditionGroup } from "@/components/base/condition-tree/ConditionGroup";
import { audienceIssueKey } from "@/lib/base/audience-draft";
import { audienceIssuesOf, issueKey } from "@/lib/base/data-scope-issues";
import {
  type ConditionDraft,
  DATA_SCOPE_AUDIENCE_FIELDS,
  type RuleDraft,
  newCondition,
} from "@/lib/base/data-scope-rule";

import type { DataScopeEditorEnv } from "../data-scope-types";
import { DataScopeConditionRow } from "./DataScopeConditionRow";

export interface RuleCardProps {
  rule: RuleDraft;
  /** 0 起算;畫面上的「規則 N」是 index + 1,與 api `path` 的 `rules[n]` 同一個 n */
  index: number;
  env: DataScopeEditorEnv;
  onChange: (next: RuleDraft) => void;
  onRemove: () => void;
}

/**
 * 一條規則(Figma `Draft/DataScopeRuleCard`):上下兩塊 ——
 * 「套用對象」(AudiencePicker:這條規則套用到誰,選所有人時條件樹收起)與
 * 「條件組合」(套用到的人看得到哪些資料)。兩棵樹共用 `ConditionGroup`,根層下拉都叫「組合」。
 * 條件組合的根就是 api 的 `filter`,所以 `childPath` 從空陣列開始。
 */
export const RuleCard = ({
  rule,
  index,
  env,
  onChange,
  onRemove,
}: RuleCardProps) => {
  const t = useTranslations("admin.dataScope.rule");
  const tReasons = useTranslations("admin.dataScope.reasons");
  const tPicker = useTranslations("admin.audiencePicker");

  const audienceIssues = new Map(
    audienceIssuesOf(env.ruleIssues, index).map((issue) => [
      audienceIssueKey(issue.childPath, issue.target),
      issue.localReason === undefined
        ? tReasons(issue.reason)
        : tPicker(issue.localReason),
    ]),
  );
  const firstField = env.fields.at(0);

  return (
    <Stack
      spacing={1.5}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        px: 2,
        py: 1.75,
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2">
          {t("title", { index: index + 1 })}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {!env.isReadOnly && (
          <Button variant="text" size="small" onClick={onRemove}>
            {t("remove")}
          </Button>
        )}
      </Stack>

      <AudiencePicker
        title={t("audience")}
        value={rule.audience}
        allowAll
        fields={DATA_SCOPE_AUDIENCE_FIELDS}
        issues={audienceIssues}
        isReadOnly={env.isReadOnly}
        onChange={(audience) => {
          onChange({ ...rule, audience });
        }}
      />

      <Stack
        component="section"
        aria-label={t("conditions")}
        spacing={1}
        sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}
      >
        <Typography variant="subtitle2" color="text.secondary">
          {t("conditions")}
        </Typography>
        <ConditionGroup<ConditionDraft>
          group={rule.filter}
          childPath={[]}
          isReadOnly={env.isReadOnly}
          createCondition={
            firstField === undefined
              ? undefined
              : () => newCondition(firstField)
          }
          errorOf={(childPath) => {
            const issue = env.issues.get(issueKey(index, childPath, "group"));
            return issue === undefined ? undefined : tReasons(issue.reason);
          }}
          renderCondition={(condition, childPath, handlers) => (
            <DataScopeConditionRow
              condition={condition}
              ruleIndex={index}
              childPath={childPath}
              env={env}
              onChange={handlers.onChange}
              onRemove={handlers.onRemove}
            />
          )}
          onChange={(filter) => {
            onChange({ ...rule, filter });
          }}
        />
      </Stack>
    </Stack>
  );
};
