import { describe, expect, it } from "@jest/globals";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, delay } from "msw";
import type { ReactNode } from "react";

import {
  type ApplyCenterCountsQuery,
  type MeQuery,
  type SidebarBadgesQuery,
  useApplyCenterCountsQuery,
  useMeQuery,
  useSidebarBadgesQuery,
} from "@repo/graphql";

import { createAuthSession } from "@/lib/base/auth/session";
import { useSessionStore } from "@/stores/base/useSessionStore";
import { testUser } from "@/test/msw/auth-handlers";
import { TEST_GRAPHQL_ENDPOINT, api, server } from "@/test/msw/server";
import { applyCenterModules } from "@/test/msw/workflow-fixtures";
import { createTestQueryClient } from "@/test/render";

import { useApplyCenterCounts } from "./useApplyCenterCounts";
import { SessionContext } from "./useSession";

const SIDEBAR_KEY = useSidebarBadgesQuery.getKey();

/** 快取:me 有申請中心權限;申請中心計數停在較早的 3、側欄是較晚的 5。 */
const seededClient = () => {
  const queryClient = createTestQueryClient();
  const me: MeQuery = {
    me: { ...testUser, modules: applyCenterModules() },
  };
  queryClient.setQueryData(useMeQuery.getKey(), me);
  const counts: ApplyCenterCountsQuery = {
    applyCenterCounts: { myTasks: 3, myApplications: 0 },
  };
  queryClient.setQueryData(useApplyCenterCountsQuery.getKey(), counts, {
    updatedAt: 1000,
  });
  const sidebar: SidebarBadgesQuery = {
    sidebarBadges: [{ moduleKey: "apply-center", count: 5 }],
  };
  queryClient.setQueryData(SIDEBAR_KEY, sidebar, { updatedAt: 2000 });
  return queryClient;
};

const renderCounts = (
  queryClient: ReturnType<typeof createTestQueryClient>,
) => {
  // 已登入(記憶體有 token):請求直接送出,不先用 cookie 換票
  useSessionStore.getState().setAccessToken("token-1");
  return renderHook(() => useApplyCenterCounts({ refetchOnMount: "always" }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <SessionContext.Provider
          value={createAuthSession(TEST_GRAPHQL_ENDPOINT, useSessionStore)}
        >
          {children}
        </SessionContext.Provider>
      </QueryClientProvider>
    ),
  });
};

const sidebarCount = (
  queryClient: ReturnType<typeof createTestQueryClient>,
): number | undefined =>
  queryClient
    .getQueryData<SidebarBadgesQuery>(SIDEBAR_KEY)
    ?.sidebarBadges.find((badge) => badge.moduleKey === "apply-center")?.count;

describe("useApplyCenterCounts 寫進側欄快取", () => {
  it("側欄已是 5、申請中心快取停在 3:進頁時側欄不倒退成 3", () => {
    // 進頁的重取一直不回來:畫面先拿快取裡較舊的 3
    server.use(
      api.query("ApplyCenterCounts", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    const queryClient = seededClient();

    const { result } = renderCounts(queryClient);

    expect(result.current.myTasks).toBe(3);
    expect(sidebarCount(queryClient)).toBe(5);
  });

  it("重取回來的數字比側欄新:寫進側欄那一筆", async () => {
    server.use(
      api.query("ApplyCenterCounts", () =>
        HttpResponse.json({
          data: { applyCenterCounts: { myTasks: 7, myApplications: 0 } },
        }),
      ),
    );
    const queryClient = seededClient();

    const { result } = renderCounts(queryClient);

    await waitFor(() => {
      expect(result.current.myTasks).toBe(7);
    });
    expect(sidebarCount(queryClient)).toBe(7);
  });
});
