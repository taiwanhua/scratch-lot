import { useTranslations } from "use-intl";

import {
  ScheduleRuleSource,
  type ScheduleRulesFieldsFragment,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import {
  type RuleLookups,
  type RuleTranslate,
  ruleParentText,
  ruleSourceText,
  ruleValueText,
} from "./rule-display";

type Rule = ScheduleRulesFieldsFragment["items"][number];

export interface RuleRowProps {
  rule: Rule;
  label: string;
  isTenantTop: boolean;
  canEdit: boolean;
  isPending: boolean;
  lookups: RuleLookups;
  onOpen: () => void;
  onRestore: () => void;
}

/**
 * 規則頁的一列:名稱 | 值(自訂時下方「上層:8 天」)| 等級標籤 | 來源 | [自訂] / [還原]。
 * 電腦 / 平板一列橫排;手機名稱一行、下方灰字「值 · 來源」(Figma SC-10 手機)。點整列打開編輯對話框。
 */
export const RuleRow = ({
  rule,
  label,
  isTenantTop,
  canEdit,
  isPending,
  lookups,
  onOpen,
  onRestore,
}: RuleRowProps) => {
  const t = useTranslations("admin.schedule.rules");
  const translate: RuleTranslate = (key, values) => t(key, values);
  const isOwn = rule.effective.source === ScheduleRuleSource.Own;
  const value = ruleValueText(translate, rule, rule.effective, lookups);
  const source = ruleSourceText(translate, rule.effective, isTenantTop);
  const level = rule.hasLevel ? rule.effective.level : null;

  return (
    <Box
      data-rule-key={rule.key}
      onClick={onOpen}
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr auto auto",
          sm: "minmax(0, 2fr) minmax(0, 1.2fr) 56px minmax(0, 1fr) 72px",
        },
        alignItems: "start",
        columnGap: 2,
        rowGap: 0.5,
        px: 2,
        py: 1.5,
        cursor: "pointer",
        borderBottom: 1,
        borderColor: "divider",
        "&:last-of-type": { borderBottom: 0 },
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Stack sx={{ minWidth: 0 }}>
        <Typography variant="body2">{label}</Typography>
        <Typography
          variant="caption"
          color="textSecondary"
          sx={{ display: { sm: "none" } }}
        >
          {value} · {source}
        </Typography>
      </Stack>
      <Stack sx={{ display: { xs: "none", sm: "flex" }, minWidth: 0 }}>
        <Typography variant="body2">{value}</Typography>
        {rule.parent && (
          <Typography variant="caption" color="textSecondary">
            {ruleParentText(translate, rule, rule.parent, lookups)}
          </Typography>
        )}
      </Stack>
      <Box>
        {level !== null && level !== undefined && (
          <Tag
            label={t(`levels.${level}`)}
            tone={level === "limit" ? "error" : "warning"}
          />
        )}
      </Box>
      <Typography
        variant="body2"
        color={isOwn ? "primary" : "textSecondary"}
        sx={{ display: { xs: "none", sm: "block" } }}
      >
        {source}
      </Typography>
      <Box sx={{ textAlign: "right" }}>
        {canEdit && (
          <Button
            variant="text"
            size="small"
            disabled={isPending}
            onClick={(event) => {
              event.stopPropagation();
              if (isOwn) {
                onRestore();
              } else {
                onOpen();
              }
            }}
          >
            {isOwn ? t("restore") : t("customize")}
          </Button>
        )}
      </Box>
    </Box>
  );
};
