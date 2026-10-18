import { useTranslations } from "use-intl";

import { Box } from "@repo/ui/box";
import { ListItemButton } from "@repo/ui/list";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import type { NotificationItem as NotificationItemData } from "@/hooks/base/useNotifications";
import { useTemporalText } from "@/hooks/base/useTemporalText";

/** 未讀圓點直徑(px;Figma `Draft/NotificationItem`)。 */
const UNREAD_DOT_SIZE = 8;

export interface NotificationItemProps {
  notification: NotificationItemData;
  onClick: (notification: NotificationItemData) => void;
}

/**
 * 通知清單的一則(Figma `Draft/NotificationItem`):未讀有主色圓點、標題粗體;
 * 已讀的標題改一般字重、顏色淡一階。時間用全站唯一的日期顯示入口(`useTemporalText`)。
 */
export const NotificationItem = ({
  notification,
  onClick,
}: NotificationItemProps) => {
  const t = useTranslations("admin.notifications");
  const temporalText = useTemporalText();
  const unread = notification.readAt === null;

  return (
    <ListItemButton
      onClick={() => {
        onClick(notification);
      }}
      sx={{ alignItems: "flex-start", gap: 1.5, px: 2, py: 1.5 }}
    >
      <Box
        role={unread ? "img" : undefined}
        aria-label={unread ? t("unread") : undefined}
        aria-hidden={unread ? undefined : true}
        sx={{
          flexShrink: 0,
          width: UNREAD_DOT_SIZE,
          height: UNREAD_DOT_SIZE,
          mt: 0.75,
          borderRadius: "50%",
          bgcolor: unread ? "primary.main" : "transparent",
        }}
      />
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Typography
          variant="subtitle2"
          color={unread ? "text.primary" : "text.secondary"}
          sx={{ fontWeight: unread ? 700 : 500 }}
        >
          {notification.title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {notification.body}
        </Typography>
        <Typography variant="caption" color="text.disabled">
          {temporalText(notification.createdAt, "datetime")}
        </Typography>
      </Stack>
    </ListItemButton>
  );
};
