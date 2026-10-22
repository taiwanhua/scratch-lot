import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { CircularProgress } from "@repo/ui/circular-progress";
import { IconButton } from "@repo/ui/icon-button";
import { CloseIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { CheckItemList } from "./CheckItemList";
import { CHECK_PANEL_HEADER } from "./check-panel-slots";
import { checkTargetOf, useRosterCheck } from "./roster-check-context";

type CheckFilter = "all" | "limit" | "reminder";

export interface CheckPanelProps {
  /** 手機底部面板的標題列多一個拉高 / 收合的把手(由外層畫) */
  handle?: ReactNode;
  /** 只畫標題列(手機收合時) */
  isCollapsed?: boolean;
}

/**
 * 檢核面板的內容(SC-18;規格 14.5「檢核面板」):標題「檢核」與 ✕、最上方給自動排班摘要的位置
 * (`check-panel-slots.ts`)、篩選 [全部] [限制 N] [提醒 N]、每項規則名稱與違反的排班 + [查看]
 * (捲到排班表那一格並閃爍)。檢核結果跟著排班表的資料一起重查(改完即時更新)。
 */
export const CheckPanel = ({
  handle,
  isCollapsed = false,
}: CheckPanelProps) => {
  const t = useTranslations("admin.schedule.roster.check");
  const { check, data, isChecking, isCheckError, setOpen, scrollToCell } =
    useRosterCheck();
  const [filter, setFilter] = useState<CheckFilter>("all");
  const items = (check?.items ?? []).filter(
    (item) => filter === "all" || item.level === filter,
  );
  const filters: { value: CheckFilter; label: string }[] = [
    {
      value: "all",
      label: t("filters.all", {
        count: (check?.limitCount ?? 0) + (check?.reminderCount ?? 0),
      }),
    },
    {
      value: "limit",
      label: t("filters.limit", { count: check?.limitCount ?? 0 }),
    },
    {
      value: "reminder",
      label: t("filters.reminder", { count: check?.reminderCount ?? 0 }),
    },
  ];

  return (
    <Stack spacing={1.5} sx={{ minHeight: 0, height: "100%" }}>
      {handle}
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <Typography variant="h6" component="h2">
          {t("title")}
        </Typography>
        <IconButton
          size="small"
          aria-label={t("close")}
          onClick={() => {
            setOpen(false);
          }}
        >
          <CloseIcon />
        </IconButton>
      </Stack>
      {!isCollapsed && (
        <>
          {CHECK_PANEL_HEADER.map((Header, index) => (
            <Header key={String(index)} />
          ))}
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap" }}
          >
            {filters.map((option) => (
              <Button
                key={option.value}
                size="small"
                variant={filter === option.value ? "contained" : "outlined"}
                aria-pressed={filter === option.value}
                onClick={() => {
                  setFilter(option.value);
                }}
              >
                {option.label}
              </Button>
            ))}
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {check === undefined && isChecking && (
              <Stack sx={{ alignItems: "center", py: 2 }}>
                <CircularProgress size={20} aria-label={t("loading")} />
              </Stack>
            )}
            {check === undefined && isCheckError && (
              <Typography variant="body2" color="textSecondary">
                {t("loadError")}
              </Typography>
            )}
            {check !== undefined && items.length === 0 && (
              <Typography variant="body2" color="textSecondary">
                {filter === "all" ? t("empty") : t("emptyFiltered")}
              </Typography>
            )}
            {items.length > 0 && (
              <CheckItemList
                items={items}
                data={data}
                onView={(item) => {
                  scrollToCell(checkTargetOf(item));
                }}
              />
            )}
          </Box>
        </>
      )}
    </Stack>
  );
};
