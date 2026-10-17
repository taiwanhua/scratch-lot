import { useMe } from "./useMe";

/**
 * 現在是不是站在根組織:`me` 已載入且 `me.currentOrg.tenantId === null`(根組織沒有最上層組織)。
 * `me` 還沒載入 → `undefined`(還不知道):呼叫端不要據此提早收起按鈕或清掉網址參數。
 *
 * 只拿來決定租戶專屬 / 根組織專屬的按鈕出不出現;真正的守門在 api(`ROOT_ONLY` / `TENANT_ONLY`)。
 */
export const useIsAtRootOrg = (): boolean | undefined => {
  const me = useMe();
  const data = me.data?.me;
  if (data === undefined) {
    return undefined;
  }
  return data.currentOrg?.tenantId === null;
};
