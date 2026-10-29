import { useCallback, useMemo } from "react";
import { useMessages, useTranslations } from "use-intl";

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

/** 攤平訊息檔的 `types` 子樹:`{ "printing.agent-offline": "Print agent offline", … }`(巢狀層級接回 `.`)。 */
const flattenTypeNames = (
  node: unknown,
  prefix: string,
  into: Map<string, string>,
): Map<string, string> => {
  if (typeof node === "string") {
    into.set(prefix, node);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, child] of Object.entries(node)) {
      flattenTypeNames(child, prefix === "" ? key : `${prefix}.${key}`, into);
    }
  }
  return into;
};

/**
 * 以畫面上的顯示名稱(目前語言的訊息檔 `admin.notifications.types.<key>`)比對關鍵字,回比中的類型 key。
 * 通知設定頁的搜尋把它送成 `nameMatchedTypes`:api 只比對登記的繁中 `name` 與 key,
 * 英文介面的名稱只在訊息檔裡,由這裡補上(不區分大小寫的子字串;空關鍵字 = 空陣列)。
 */
export const useNotificationTypesMatchingName = (): ((
  keyword: string,
) => string[]) => {
  const messages = useMessages() as Record<string, unknown>;
  const names = useMemo(() => {
    const admin = messages.admin as Record<string, unknown> | undefined;
    const notifications = admin?.notifications as
      Record<string, unknown> | undefined;
    return flattenTypeNames(notifications?.types, "", new Map());
  }, [messages]);
  return useCallback(
    (keyword: string) => {
      const needle = keyword.trim().toLowerCase();
      if (needle === "") {
        return [];
      }
      return [...names]
        .filter(([, name]) => name.toLowerCase().includes(needle))
        .map(([type]) => type);
    },
    [names],
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
