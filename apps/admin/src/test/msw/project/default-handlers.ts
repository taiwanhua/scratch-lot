import type { RequestHandler, graphql } from "msw";

type GraphQLLink = ReturnType<typeof graphql.link>;

/**
 * 專案的測試預設 handler(`server.ts` 的初始 handler 之後展開;底座版回空陣列)。
 * 收 `server.ts` 的 `api`(測試端點的 link)當參數,不反過來 import `server.ts`(避免循環載入)。
 *
 * 專案替換了底座頁時,底座頁自己的測試經路由看到的是專案版(jest 的 `admin` project 用正式的
 * `app/project/` 登記),專案版多打的 api 在這裡給「沒有資料」的預設回應,底座測試就不會出現
 * 未處理的請求。要驗資料的測試用各自的 world 以 `server.use()` 蓋過。目前沒有替換頁要補。
 */
export const projectDefaultHandlers: (
  api: GraphQLLink,
) => RequestHandler[] = () => [];
