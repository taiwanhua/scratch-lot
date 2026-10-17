import { useEffect, useRef } from "react";
import { useTranslations } from "use-intl";

import { useMyNotificationsQuery } from "@repo/graphql";

import { useSnackbar } from "./useMutationFeedback";
import { useRealtimeSignal } from "./useRealtime";
import { useSession } from "./useSession";

/**
 * 幾毫秒內陸續到的 `notification` 信號算「同時收到」,只跳一則提示。
 * 送出端不合併 `notification`(底座規格第 4 章),一個事件通知同一人多次(或幾個事件幾乎同時)時信號會連發。
 */
export const NOTIFICATION_ALERT_WINDOW_MS = 1000;

/**
 * 新通知提示(底座規格第 5 章 UI、10.12):收到 `notification` 信號 → 右下角一則 Snackbar,
 * Severity=Info、有標題、沒有動作(4 秒消失,沿用統一的 Snackbar)。
 *
 * - 信號不帶資料:窗內只收到 1 則時向 api 拿最新一則未讀通知,標題 = 通知標題、內容 = 通知內文;
 *   拿不到(已被讀掉、請求失敗)時退回「你有 1 則新通知」。
 * - 窗內收到多則:只跳一則「你有 N 則新通知」(標題「新通知」)。
 * - 未讀數與清單由信號登記表(`app/base/realtime-signals.ts`)重抓,這裡只管提示。
 *
 * 掛在通知鈴上(頂端列,登入後一直在)。
 */
export const useNotificationAlerts = (): void => {
  const t = useTranslations("admin.notifications");
  const show = useSnackbar();
  const { session } = useSession();
  const pending = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      // 清掉才不會讓再掛載(StrictMode 的卸載 → 掛載)後的信號以為計時器還在跑而不排新的
      timer.current = null;
      pending.current = 0;
    },
    [],
  );

  const flush = async () => {
    const count = pending.current;
    pending.current = 0;
    timer.current = null;
    const many = { title: t("alert.title") };
    if (count > 1) {
      show("info", t("alert.many", { count }), many);
      return;
    }
    try {
      const data = await useMyNotificationsQuery.fetcher(session.client, {
        input: { unreadOnly: true, page: 1, pageSize: 1 },
      })();
      const latest = data.myNotifications.items.at(0);
      if (latest !== undefined) {
        show("info", latest.body, { title: latest.title });
        return;
      }
    } catch {
      // 拿不到內容仍提示有新通知(數字由信號登記表重抓)
    }
    show("info", t("alert.many", { count }), many);
  };

  useRealtimeSignal("notification", () => {
    pending.current += 1;
    timer.current ??= setTimeout(() => {
      void flush();
    }, NOTIFICATION_ALERT_WINDOW_MS);
  });
};
