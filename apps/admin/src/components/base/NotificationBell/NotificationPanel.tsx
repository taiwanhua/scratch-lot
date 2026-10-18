import { type UIEvent, useState } from "react";
import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { CircularProgress } from "@repo/ui/circular-progress";
import { NotificationsIcon } from "@repo/ui/icons";
import { List } from "@repo/ui/list";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  type NotificationItem as NotificationItemData,
  useNotificationList,
} from "@/hooks/base/useNotifications";

import { NotificationItem } from "./NotificationItem";

/** 清單浮層寬(px;Figma `Draft/NotificationPanel`)。 */
const PANEL_WIDTH = 360;
/** 清單可捲動區的最大高度(px);超過就捲動,捲到底載入下一批。 */
const LIST_MAX_HEIGHT = 480;
/** 離底部多近就開始載入下一批(px)。 */
const LOAD_MORE_THRESHOLD = 48;

type Filter = "all" | "unread";

export interface NotificationPanelProps {
  /** 未讀數:0 時不顯示「全部標為已讀」 */
  unreadCount: number;
  onMarkAllRead: () => void;
  onItemClick: (notification: NotificationItemData) => void;
}

/**
 * 通知清單(Figma `Draft/NotificationPanel`):
 * 標題列「通知」+「全部標為已讀」、「全部 / 未讀」切換、依時間新到舊一次 20 則,捲到底載入下一批,
 * 沒有更多時不再載入。
 */
export const NotificationPanel = ({
  unreadCount,
  onMarkAllRead,
  onItemClick,
}: NotificationPanelProps) => {
  const t = useTranslations("admin.notifications");
  const [filter, setFilter] = useState<Filter>("all");
  const list = useNotificationList(filter === "unread", true);

  const handleScroll = (event: UIEvent<HTMLElement>) => {
    const target = event.currentTarget;
    const remaining =
      target.scrollHeight - target.scrollTop - target.clientHeight;
    if (
      remaining <= LOAD_MORE_THRESHOLD &&
      list.hasNextPage &&
      !list.isFetchingNextPage
    ) {
      void list.loadMore();
    }
  };

  const renderBody = () => {
    if (list.isPending) {
      return (
        <Stack sx={{ alignItems: "center", py: 4 }}>
          <CircularProgress size={24} />
        </Stack>
      );
    }
    if (list.isError) {
      return (
        <Typography
          variant="body2"
          color="error"
          sx={{ px: 2, py: 4, textAlign: "center" }}
        >
          {t("loadFailed")}
        </Typography>
      );
    }
    if (list.items.length === 0) {
      return (
        <Stack spacing={1} sx={{ alignItems: "center", py: 5 }}>
          <NotificationsIcon sx={{ color: "text.secondary" }} />
          <Typography variant="body2" color="text.secondary">
            {filter === "unread" ? t("emptyUnread") : t("empty")}
          </Typography>
        </Stack>
      );
    }
    return (
      <Box
        data-testid="notification-list"
        onScroll={handleScroll}
        sx={{ maxHeight: LIST_MAX_HEIGHT, overflowY: "auto" }}
      >
        <List disablePadding aria-label={t("title")}>
          {list.items.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onClick={onItemClick}
            />
          ))}
        </List>
        {list.isFetchingNextPage && (
          <Stack sx={{ alignItems: "center", py: 1.5 }}>
            <CircularProgress size={20} />
          </Stack>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ width: PANEL_WIDTH }}>
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
          {t("title")}
        </Typography>
        {unreadCount > 0 && (
          <Button size="small" variant="text" onClick={onMarkAllRead}>
            {t("markAllRead")}
          </Button>
        )}
      </Stack>
      <Box sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
        <SegmentedControl<Filter>
          aria-label={t("filter")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("filterAll") },
            { value: "unread", label: t("filterUnread") },
          ]}
        />
      </Box>
      {renderBody()}
    </Box>
  );
};
