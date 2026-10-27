import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import type { RosterData } from "../roster-context";
import type { RosterCheckItem } from "./roster-check-context";
import { useCheckItemText } from "./useCheckItemText";

export interface CheckItemListProps {
  items: readonly RosterCheckItem[];
  data: RosterData | undefined;
  /** [查看]:捲到那一格並閃爍(發布確認視窗另外先關視窗) */
  onView: (item: RosterCheckItem) => void;
}

/**
 * 檢核項目清單(SC-18 面板、SC-15c / d 發布確認視窗共用):等級標籤(限制紅、提醒橘)、
 * 規則名稱與違反的排班、[查看]。
 */
export const CheckItemList = ({ items, data, onView }: CheckItemListProps) => {
  const t = useTranslations("admin.schedule.roster.check");
  const tRules = useTranslations("admin.schedule.rules");
  const textOf = useCheckItemText(data);

  return (
    <Stack component="ul" spacing={1.5} sx={{ listStyle: "none", m: 0, p: 0 }}>
      {items.map((item, index) => {
        const text = textOf(item);
        return (
          <Stack
            component="li"
            key={`${item.key}|${item.date}|${item.userId ?? ""}|${String(index)}`}
            direction="row"
            spacing={1}
            sx={{ alignItems: "flex-start" }}
          >
            <Tag
              tone={item.level === "limit" ? "error" : "warning"}
              label={tRules(`levels.${item.level}`)}
              sx={{ flex: "none", mt: 0.25 }}
            />
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
              {text}
            </Typography>
            <Button
              variant="text"
              size="small"
              sx={{ flex: "none", minWidth: 0 }}
              aria-label={t("viewAria", { text })}
              onClick={() => {
                onView(item);
              }}
            >
              {t("view")}
            </Button>
          </Stack>
        );
      })}
    </Stack>
  );
};
