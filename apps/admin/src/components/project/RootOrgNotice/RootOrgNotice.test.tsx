import { afterEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { authWorld, overviewModule } from "@/test/msw/auth-handlers";
import {
  ALL_ACCOUNTS_PERMISSIONS,
  accountsModules,
} from "@/test/msw/project/lottery/accounts-fixtures";
import { accountsWorld } from "@/test/msw/project/lottery/accounts-handlers";
import { scheduleModules } from "@/test/msw/project/schedule-module-fixtures";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

const ROOT = { id: "org-root", name: "平台" };
const MESSAGE = "目前在平台層級,請先切換到要管理的機構";

/** 這次測試發出的 GraphQL 操作名稱(看被擋的頁有沒有發專案查詢)。 */
const operations: string[] = [];
const recordOperation = ({ request }: { request: Request }) => {
  void request
    .clone()
    .json()
    .then((body: unknown) => {
      const name = (body as { operationName?: unknown }).operationName;
      if (typeof name === "string") {
        operations.push(name);
      }
    })
    .catch(() => null);
};

/** 站在根組織(`me.currentOrg.tenantId = null`)打開專案模組頁。 */
const renderAtRoot = (path: string) => {
  const fake = accountsWorld({ permissions: ALL_ACCOUNTS_PERMISSIONS });
  server.use(
    ...fake.handlers,
    ...authWorld({
      hasRefreshCookie: true,
      orgs: [ROOT, { id: "org-tenant", name: "好運彩券行" }],
      // 依組織決定(切換後跟著重算):根組織 → null、機構 → 它自己
      currentOrgTenantId: (orgId) => (orgId === ROOT.id ? null : orgId),
      modules: [
        overviewModule,
        ...accountsModules({ permissions: ALL_ACCOUNTS_PERMISSIONS }),
        ...scheduleModules(),
      ],
    }).handlers,
  );
  return renderApp({ path });
};

/**
 * 根組織進專案功能(Spec #143 定案 8、ADR-0014):每個專案模組頁(`app/project/module-pages.ts` 的
 * `gateTenant`)都先顯示「目前在平台層級」與切換入口,不掛頁面本身。
 */
describe("根組織打開專案模組頁:先請使用者切換到要管理的機構", () => {
  afterEach(() => {
    server.events.removeListener("request:start", recordOperation);
    operations.length = 0;
  });

  it("帳戶管理:顯示提示與當前組織切換器,不顯示頁面內容", async () => {
    server.events.on("request:start", recordOperation);
    renderAtRoot("/accounts");
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
    // AppBar 一個、提示裡一個:同一個切換器
    expect(screen.getAllByRole("combobox", { name: "當前組織" })).toHaveLength(
      2,
    );
    expect(screen.queryByRole("tab", { name: "銀行帳戶" })).toBeNull();
    // 頁面本身沒掛上:沒有發任何專案查詢(只有殼的 Me / 側欄數字 / 通知…)
    await waitFor(() => {
      expect(operations).toContain("Me");
    });
    expect(
      operations.filter((name) => /^(Lottery|Schedule)/.test(name)),
    ).toEqual([]);
  });

  it.each(["/schedule/my", "/schedule/manage"])(
    "排班(固定頁、表單模組的頁都一樣):%s",
    async (path) => {
      renderAtRoot(path);
      expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
    },
  );

  it("用提示裡的切換器切到機構 → 頁面照常顯示", async () => {
    const { user } = renderAtRoot("/accounts");
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
    const [, inNotice] = screen.getAllByRole("combobox", { name: "當前組織" });
    await user.click(inNotice);
    await user.click(await screen.findByRole("option", { name: "好運彩券行" }));
    expect(
      await screen.findByRole("tab", { name: "銀行帳戶" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});
