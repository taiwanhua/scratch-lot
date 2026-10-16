import { setupWorker } from "msw/browser";

import { GRAPHQL_ENDPOINT } from "@/lib/base/graphql";
import { TEST_GRAPHQL_ENDPOINT } from "@/test/msw/server";

import type { MockView } from "./mock-fixtures";
import { mockHandlers } from "./mock-world";

/**
 * mock 模式的瀏覽器端假 api:`msw/browser` 的 `setupWorker` + `src/test/msw/` 的既有夾具。
 * 測試那一端用的是 `msw/node` 的 `setupServer`(`src/test/msw/server.ts`),兩邊共用同一批 handlers。
 */

/** 網址參數:`?view=root|tenant`(預設 root)、`?auth=off`(不自動登入,停在登入頁)。 */
const readOptions = (search: string) => {
  const parameters = new URLSearchParams(search);
  const view: MockView =
    parameters.get("view") === "tenant" ? "tenant" : "root";
  return { view, authenticated: parameters.get("auth") !== "off" };
};

/**
 * 註冊 service worker 並掛上 handlers。**一定要 await 完才渲染 App** —— App 一 mount
 * 就會打 `refresh` 換票,worker 還沒接管的話那一發會打到真的網路。
 */
export const startMockWorker = async (search: string): Promise<void> => {
  if (GRAPHQL_ENDPOINT !== TEST_GRAPHQL_ENDPOINT) {
    throw new Error(
      `mock 模式的 GRAPHQL_ENDPOINT 是 ${GRAPHQL_ENDPOINT},夾具攔的是 ${TEST_GRAPHQL_ENDPOINT} —— ` +
        "請把 vite.mock.config.ts 的 MOCK_GRAPHQL_ENDPOINT 對回 src/test/msw/server.ts 的 TEST_GRAPHQL_ENDPOINT",
    );
  }

  const worker = setupWorker(...mockHandlers(readOptions(search)));
  await worker.start({
    // Vite 自己的模組 / HMR 請求一律放行,只有「打到假 api 卻沒人接」才值得警告
    onUnhandledRequest: (request, print) => {
      if (request.url.startsWith(TEST_GRAPHQL_ENDPOINT)) {
        print.warning();
      }
    },
  });
};
