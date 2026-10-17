import { useMemo } from "react";

import type { LiveIdentity } from "@/lib/base/form-engine/expression-context";

import { useMe } from "./useMe";

/**
 * 填寫中表達式的身分(`ctx.user.*` / `ctx.tenant.id`):登入者、目前組織、所屬組織全部(`me.orgs`)、
 * 目前組織的租戶頂層(`me.currentOrg.tenantId`)。以 `useMemo` 保持身分穩定(`liveContextOf` 的依賴)。
 */
export const useLiveIdentity = (): LiveIdentity => {
  const user = useMe().data?.me;
  const userId = user?.id ?? null;
  const orgId = user?.currentOrg?.id ?? null;
  const tenantId = user?.currentOrg?.tenantId ?? null;
  const orgIdsKey = (user?.orgs ?? []).map((org) => org.id).join(",");
  return useMemo(
    () => ({
      userId,
      orgId,
      orgIds: orgIdsKey === "" ? [] : orgIdsKey.split(","),
      tenantId,
    }),
    [userId, orgId, orgIdsKey, tenantId],
  );
};
