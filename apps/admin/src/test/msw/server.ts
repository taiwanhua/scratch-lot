import { HttpResponse, graphql } from "msw";
import { setupServer } from "msw/node";

/** 測試用的 GraphQL 端點;AuthSession 與 handler 都對準它。 */
export const TEST_GRAPHQL_ENDPOINT = "https://api.test/graphql";

/** 只攔測試端點的 GraphQL 操作(operationName 對應 packages/graphql 文件裡的操作名)。 */
export const api = graphql.link(TEST_GRAPHQL_ENDPOINT);

/**
 * 初始 handler(優先序最低:`server.use()` 加的都排在它前面,`resetHandlers()` 後仍在):
 * 殼一登入就查側欄計數(`SidebarBadges`),沒有特別準備的測試一律「沒有數字」;
 * 要驗數字的 world(如 `workflowRuntimeWorld`)自己再登記一份蓋過它。
 * 不放進 `authWorld`:它通常排在最前面,會蓋掉各 world 的版本。
 */
export const server = setupServer(
  api.query("SidebarBadges", () =>
    HttpResponse.json({ data: { sidebarBadges: [] } }),
  ),
);
