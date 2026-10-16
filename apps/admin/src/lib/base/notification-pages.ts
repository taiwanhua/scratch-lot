/**
 * 通知清單的分頁合併(底座規格第 5 章「通知鈴與通知清單」)。
 *
 * `myNotifications` 用 `page` / `pageSize`(offset)分頁、依時間新到舊:捲到底載入下一批的途中
 * 有新通知進來,整串往後推一格,下一頁的第一筆會是上一頁已經有的那一筆(不會漏,只會重複)。
 * 所以合併各頁時以通知 `id` 去重,保留**先出現**的那一筆(位置不跳)。
 */

/** 清單一次載入幾則(規格:一次 20 則)。 */
export const NOTIFICATION_PAGE_SIZE = 20;

/** 未讀數超過這個數字時 🔔 顯示「99+」。 */
export const NOTIFICATION_BADGE_MAX = 99;

export interface NotificationPage<Item extends { id: string }> {
  items: readonly Item[];
  page: number;
  pageSize: number;
  totalCount: number;
}

/** 依序攤平各頁,同一個 id 只留第一次出現的那筆。 */
export const mergeNotificationPages = <Item extends { id: string }>(
  pages: readonly NotificationPage<Item>[],
): Item[] => {
  const seen = new Set<string>();
  const merged: Item[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        merged.push(item);
      }
    }
  }
  return merged;
};

/** 下一批的頁碼;已經載到最後一頁 → `undefined`(不再載入)。 */
export const nextNotificationPage = (
  last: NotificationPage<{ id: string }>,
): number | undefined =>
  last.page * last.pageSize < last.totalCount ? last.page + 1 : undefined;
