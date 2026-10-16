import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { RuleDraft } from "@/lib/base/data-scope-rule";

import type { DataScopeEditorEnv } from "../data-scope-types";
import { ConditionGroup } from "./ConditionGroup";
import { RuleAudience } from "./RuleAudience";

export interface RuleCardProps {
  rule: RuleDraft;
  /** 0 起算;畫面上的「規則 N」是 index + 1,與 api `path` 的 `rules[n]` 同一個 n */
  index: number;
  env: DataScopeEditorEnv;
  onChange: (next: RuleDraft) => void;
  onRemove: () => void;
}

/**
 * 一條規則(Figma 167:1718 / 167:1776):套用對象 + 條件樹。
 * 條件樹的根就是 api 的 `filter`,所以這裡的 `childPath` 從空陣列開始。
 */
export const RuleCard = ({
  rule,
  index,
  env,
  onChange,
  onRemove,
}: RuleCardProps) => {
  const t = useTranslations("admin.dataScope.rule");

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
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
        <Typography variant="subtitle2" sx={{ pt: 1.25 }}>
          {t("title", { index: index + 1 })}
        </Typography>
        <RuleAudience
          audience={rule.audience}
          ruleIndex={index}
          env={env}
          onChange={(audience) => {
            onChange({ ...rule, audience });
          }}
        />
        <Box sx={{ flex: 1 }} />
        {!env.isReadOnly && (
          <Button variant="text" size="small" onClick={onRemove}>
            {t("remove")}
          </Button>
        )}
      </Stack>

      <ConditionGroup
        group={rule.filter}
        ruleIndex={index}
        childPath={[]}
        env={env}
        onChange={(filter) => {
          onChange({ ...rule, filter });
        }}
      />
    </Stack>
  );
};
