import { useMeQuery } from "@repo/graphql";

import { useSession } from "./useSession";

/**
 * 登入者資料(`me`)的唯一入口:react-query 全域快取(#61),所有頁面共用同一份。
 * - 只在已登入時查;未登入時 SessionProvider 會清掉快取
 * - `staleTime: Infinity` + `retryOnMount: false`:多一個元件掛上(不論 me 已成功或失敗)都不重打 —
 *   路由守門(RequireAuth)靠 `me` 判斷首登強改,若子頁掛上就重打,守門會在「等待 → 渲染子頁 → 子頁重打 → 等待」之間無限循環。
 *   要重取一律 `invalidateQueries({ queryKey: useMeQuery.getKey() })`(如改密碼成功後清 `mustChangePassword`)
 */
export const useMe = () => {
  const { session, snapshot } = useSession();
  return useMeQuery(session.client, undefined, {
    enabled: snapshot.status === "authenticated",
    staleTime: Number.POSITIVE_INFINITY,
    retryOnMount: false,
  });
};
