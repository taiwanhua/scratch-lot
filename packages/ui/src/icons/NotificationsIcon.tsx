"use client";

import NotificationsOutlined from "@mui/icons-material/NotificationsOutlined";

import type { IconProps } from "./icon-props";

/**
 * 通知鈴(頂端列的 🔔、通知清單的空狀態;Figma `Draft/NotificationBell`)。取自
 * `@mui/icons-material/NotificationsOutlined`(與模組圖示白名單的 `notifications` 同一個圖),
 * 做法與理由同 `EditIcon`(單檔路徑 import,顏色跟著父層文字色)。
 */
export const NotificationsIcon = (props: IconProps) => (
  <NotificationsOutlined {...props} />
);
