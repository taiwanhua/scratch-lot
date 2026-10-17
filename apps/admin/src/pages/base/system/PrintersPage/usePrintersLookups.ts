import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
  type PrintAgentFieldsFragment,
  useOrgTreeQuery,
  usePrintAgentsQuery,
  usePrintJobsQuery,
  usePrintersQuery,
} from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import { type OrgOption, flattenOrgs } from "@/lib/base/org-tree";

/** 代理程式對照表一次取的筆數(api 上限 100;一個租戶的分店數遠低於它)。 */
const AGENT_LOOKUP_PAGE_SIZE = 100;

/** 對照表用的代理程式查詢:連已停用的一起(印表機與列印紀錄要顯示當初那一台的名稱)。 */
const AGENT_LOOKUP_INPUT = {
  includeDisabled: true,
  pageSize: AGENT_LOOKUP_PAGE_SIZE,
} as const;

export interface PrintersLookups {
  /** 管理範圍內的組織(組織篩選、表格的「所屬組織」) */
  orgs: readonly OrgOption[];
  orgNameOf: (orgId: string) => string;
  /** 所有代理程式(含已停用);印表機的「代理程式」欄、新增 / 編輯印表機的選單 */
  agents: readonly PrintAgentFieldsFragment[];
  agentOf: (agentId: string) => PrintAgentFieldsFragment | undefined;
}

/**
 * 三個分頁共用的對照資料:組織名稱(`orgTree`,只受管理範圍限制)與代理程式(名稱、連線狀態)。
 * 印表機 / 列印紀錄只帶 id,畫面上要顯示名稱。
 */
export const usePrintersLookups = (): PrintersLookups => {
  const { session } = useSession();
  const orgTree = useOrgTreeQuery(session.client);
  const agentList = usePrintAgentsQuery(session.client, {
    input: AGENT_LOOKUP_INPUT,
  });

  const orgs = useMemo(
    () => flattenOrgs(orgTree.data?.orgTree ?? []),
    [orgTree.data],
  );
  const orgNames = useMemo(
    () => new Map(orgs.map((org) => [org.id, org.name])),
    [orgs],
  );
  const agents = useMemo(
    () => agentList.data?.printAgents.items ?? [],
    [agentList.data],
  );
  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  const orgNameOf = useCallback(
    (orgId: string) => orgNames.get(orgId) ?? "—",
    [orgNames],
  );
  const agentOf = useCallback(
    (agentId: string) => agentsById.get(agentId),
    [agentsById],
  );

  return { orgs, orgNameOf, agents, agentOf };
};

/**
 * 寫入後的精準失效(DATA-04 的 (b);各 mutation 的 payload 只有單筆,清單一律重取):
 * 三種清單各自帶分頁 / 篩選,取 getKey 的第一段當前綴一次掃掉。
 */
export const useInvalidatePrinters = () => {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: usePrintersQuery.getKey({ input: {} }).slice(0, 1),
      }),
      queryClient.invalidateQueries({
        queryKey: usePrintAgentsQuery.getKey({ input: {} }).slice(0, 1),
      }),
      queryClient.invalidateQueries({
        queryKey: usePrintJobsQuery.getKey({ input: {} }).slice(0, 1),
      }),
    ]);
  }, [queryClient]);
};
