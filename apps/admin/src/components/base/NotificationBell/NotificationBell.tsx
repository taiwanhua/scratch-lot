import { type MouseEvent, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Badge } from "@repo/ui/badge";
import { IconButton } from "@repo/ui/icon-button";
import { NotificationsIcon } from "@repo/ui/icons";
import { Popover } from "@repo/ui/popover";

import { useNotificationAlerts } from "@/hooks/base/useNotificationAlerts";
import {
  type NotificationItem,
  useMarkNotificationsRead,
  useNotificationUnreadCount,
} from "@/hooks/base/useNotifications";
import { NOTIFICATION_BADGE_MAX } from "@/lib/base/notification-pages";

import { NotificationPanel } from "./NotificationPanel";

/**
 * 頂端列的通知鈴(Figma `Draft/NotificationBell` 50:567、BS-08 289:85622;底座規格第 5 章 UI):
 * 🔔 + 未讀數(超過 99 顯示「99+」),點開為通知清單。
 *
 * - 點一則通知:標已讀(未讀才送)並打開連結(api 依連結登記表換好的站內路徑);沒有連結只標已讀。
 *   連結頁面沒有權限或資料已不在 → 照常標已讀,由頁面顯示既有的無權限 / 找不到狀態。
 * - 收到 `notification` 信號:未讀數與清單由信號登記表重抓;右下角提示由 `useNotificationAlerts` 跳。
 *
 * 通知鈴不是模組:所有登入者都有,不看權限(api `myNotifications` 等只讀寫自己的)。
 */
export const NotificationBell = () => {
  const t = useTranslations("admin.notifications");
  const navigate = useNavigate();
  const unreadCount = useNotificationUnreadCount();
  const { markRead, markAllRead } = useMarkNotificationsRead();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useNotificationAlerts();

  const close = () => {
    setAnchor(null);
  };

  const handleItemClick = (notification: NotificationItem) => {
    if (notification.readAt === null) {
      markRead.mutate({ input: { ids: [notification.id] } });
    }
    if (typeof notification.link === "string") {
      close();
      void navigate(notification.link);
    }
  };

  return (
    <>
      <IconButton
        aria-label={
          unreadCount > 0
            ? t("bellWithCount", { count: unreadCount })
            : t("bell")
        }
        aria-haspopup="dialog"
        onClick={(event: MouseEvent<HTMLElement>) => {
          setAnchor(event.currentTarget);
        }}
        sx={{ color: "text.secondary" }}
      >
        <Badge
          color="primary"
          badgeContent={unreadCount}
          max={NOTIFICATION_BADGE_MAX}
        >
          <NotificationsIcon />
        </Badge>
      </IconButton>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { role: "dialog", "aria-label": t("title") } }}
      >
        <NotificationPanel
          unreadCount={unreadCount}
          onMarkAllRead={() => {
            markAllRead.mutate({});
          }}
          onItemClick={handleItemClick}
        />
      </Popover>
    </>
  );
};
