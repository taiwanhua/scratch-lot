import { useCallback } from "react";
import { useTranslations } from "use-intl";

/** 通知類型名稱的訊息 namespace:`admin.notifications.types.<類型 key>`(key 的 `.` 就是巢狀層級)。 */
const NOTIFICATION_NAMESPACE = "admin.notifications";

/**
 * 通知類型的顯示名稱:依類型 key 從訊息檔
 * `admin.notifications.types.<key>` 取;沒有這個 key 就退回 api 回的 `name`(通知類型登記表的
 * 繁中名稱)。通知設定頁、個人設定的通知管道開關與 🔔 清單一律用這一支,不各自決定名稱。
 *
 * 例:`workflow.task-created` → `types.workflow.task-created`(en:「Awaiting your review」)。
 * 專案的類型在專案字典加同樣的 key 即可;沒加的照樣顯示登記的名稱。
 */
export const useNotificationTypeName = (): ((
  type: string,
  fallbackName: string,
) => string) => {
  const t = useTranslations(NOTIFICATION_NAMESPACE);
  return useCallback(
    (type: string, fallbackName: string) => {
      const key = `types.${type}`;
      return t.has(key) ? t(key) : fallbackName;
    },
    [t],
  );
};

/**
 * 當事人通知的收件人說明(通知設定頁「由事件決定(<說明>)」):依類型 key 從訊息檔
 * `admin.notifications.recipientNotes.<key>` 取;沒有就退回 api 的 `recipientNote`(類型登記的繁中說明),
 * 再沒有 = null。日期稱呼 `scheduleDateLabels.<key>` 是同一種覆寫方式。
 */
export const useNotificationRecipientNote = (): ((
  type: string,
  fallbackNote: string | null | undefined,
) => string | null) => {
  const t = useTranslations(NOTIFICATION_NAMESPACE);
  return useCallback(
    (type: string, fallbackNote: string | null | undefined) => {
      const key = `recipientNotes.${type}`;
      return t.has(key) ? t(key) : (fallbackNote ?? null);
    },
    [t],
  );
};
