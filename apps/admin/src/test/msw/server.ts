import { HttpResponse, graphql } from "msw";
import { setupServer } from "msw/node";

import { projectDefaultHandlers } from "./project/default-handlers";

/** 測試用的 GraphQL 端點;AuthSession 與 handler 都對準它。 */
export const TEST_GRAPHQL_ENDPOINT = "https://api.test/graphql";

/** 只攔測試端點的 GraphQL 操作(operationName 對應 packages/graphql 文件裡的操作名)。 */
export const api = graphql.link(TEST_GRAPHQL_ENDPOINT);

/**
 * 初始 handler(優先序最低:`server.use()` 加的都排在它前面,`resetHandlers()` 後仍在):
 * 殼一登入就查側欄計數(`SidebarBadges`),沒有特別準備的測試一律「沒有數字」;
 * 要驗數字的 world(如 `workflowRuntimeWorld`)自己再登記一份蓋過它。
 * 不放進 `authWorld`:它通常排在最前面,會蓋掉各 world 的版本。
 * 頂端列的通知鈴同理:一登入就查未讀數(`MyNotificationUnreadCount`),預設「沒有未讀」;
 * 個人設定的偏好分頁查管道開關(`MyNotificationPreferences`),預設沒有類型。
 * 要驗通知的測試用 `notificationWorld`(`test/msw/notification-handlers.ts`)蓋過。
 * 最後接專案的預設 handler(`test/msw/project/default-handlers.ts`,底座版為空):專案替換底座頁後,
 * 專案版多打的 api 有「沒有資料」的預設回應,底座頁的測試不會出現未處理的請求。
 */
export const server = setupServer(
  api.query("SidebarBadges", () =>
    HttpResponse.json({ data: { sidebarBadges: [] } }),
  ),
  api.query("MyNotificationUnreadCount", () =>
    HttpResponse.json({ data: { myNotificationUnreadCount: { count: 0 } } }),
  ),
  api.query("MyNotificationPreferences", () =>
    HttpResponse.json({ data: { myNotificationPreferences: { items: [] } } }),
  ),
  ...projectDefaultHandlers(api),
);
