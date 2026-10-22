import { z } from "zod";

import { useMe } from "@/hooks/base/useMe";
import { useUrlState } from "@/hooks/base/useUrlState";

const orgSchema = z.string().default("");

/** 分頁看的分店:網址 `?org=`(和看板同一個,切分頁不換店);沒帶 = 目前組織。 */
export const useStoreFormsOrg = (): [string, (orgId: string) => void] => {
  const me = useMe();
  const [orgParam, setOrgParam] = useUrlState("org", orgSchema);
  const orgId = orgParam === "" ? (me.data?.me.currentOrg?.id ?? "") : orgParam;
  return [orgId, setOrgParam];
};
