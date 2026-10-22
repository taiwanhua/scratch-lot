import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { Types } from "mongoose";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../../auth/test-support/auth-app";
import { createOrg } from "../../auth/test-support/fixtures";
import type { OperatorContext } from "../../database/operator-context";
import { HOOK_TIMEOUT_MS } from "../../database/test-support/mongo-connection";
import { login } from "../../demo-items-two/test-support/fixtures";
import {
  GAME_MODULES,
  createMasterDataOperator,
  errorOf,
  ok,
  seedMasterDataAuthorization,
} from "../lottery/test-support/master-data-fixtures";
import { TENANT_ONLY_REASON, isAtRootOrg } from "./root-org";

const operatorOf = (
  overrides: Partial<OperatorContext> = {},
): OperatorContext =>
  ({
    actorId: new Types.ObjectId(),
    currentOrgId: new Types.ObjectId(),
    memberTenants: [],
    visibleOrgIds: "all",
    ...overrides,
  }) as unknown as OperatorContext;

describe("isAtRootOrg:當前組織是不是根組織(同 tenantOfOperator 的判準)", () => {
  it("不屬於任何租戶 + 可見範圍全部 → 根組織;屬於某租戶、沒有當前組織都不算", () => {
    expect(isAtRootOrg(operatorOf())).toBe(true);
    const current = new Types.ObjectId();
    expect(
      isAtRootOrg(
        operatorOf({
          currentOrgId: current,
          memberTenants: [
            { tenantId: new Types.ObjectId(), memberOrgIds: [current] },
          ] as unknown as OperatorContext["memberTenants"],
        }),
      ),
    ).toBe(false);
    expect(isAtRootOrg(operatorOf({ currentOrgId: null }))).toBe(false);
    expect(isAtRootOrg(operatorOf({ visibleOrgIds: [current] }))).toBe(false);
  });
});

/** 各專案模組的代表端點(查詢不需要真的有資料:根組織在權限檢查前就被擋)。 */
const PROJECT_QUERIES: readonly {
  name: string;
  query: string;
  variables: (orgId: string) => Record<string, unknown>;
}[] = [
  {
    name: "檔案管理 lotteryGames",
    query: `query ($input: LotteryGamesInput!) { lotteryGames(input: $input) { totalCount } }`,
    variables: () => ({ input: {} }),
  },
  {
    name: "進貨單 lotteryPurchaseOptions",
    query: `query ($orgId: ID!) { lotteryPurchaseOptions(orgId: $orgId) { games { id } } }`,
    variables: (orgId) => ({ orgId }),
  },
  {
    name: "叫貨單 lotteryRequisitionCandidates",
    query: `query ($orgId: ID!) { lotteryRequisitionCandidates(orgId: $orgId) { gameId } }`,
    variables: (orgId) => ({ orgId }),
  },
  {
    name: "調貨單 lotteryTransferOptions",
    query: `query ($orgId: ID!) { lotteryTransferOptions(fromOrgId: $orgId) { requisitions { id } } }`,
    variables: (orgId) => ({ orgId }),
  },
  {
    name: "帳戶管理 lotteryBankAccounts",
    query: `query ($input: LotteryBankAccountsInput!) { lotteryBankAccounts(input: $input) { totalCount } }`,
    variables: () => ({ input: {} }),
  },
  {
    name: "店面管理 lotteryStoreBoard",
    query: `query ($orgId: ID!) { lotteryStoreBoard(orgId: $orgId) { item { vaultExpected } } }`,
    variables: (orgId) => ({ orgId }),
  },
  {
    name: "排班設定 scheduleStaff",
    query: `query { scheduleStaff(input: null) { totalCount } }`,
    variables: () => ({}),
  },
  {
    name: "我的班表 myScheduleDayOffs",
    query: `query { myScheduleDayOffs(input: null) { dayOffCount } }`,
    variables: () => ({}),
  },
];

describe("根組織進專案功能:一律 FORBIDDEN + reason TENANT_ONLY(要先切進租戶)", () => {
  let api: AuthTestApp;
  let rootToken: string;
  let tenantToken: string;
  let tenantId: Types.ObjectId;

  beforeAll(async () => {
    api = await startAuthTestApp("scratch-lot-test-tenant-scope");
    await seedMasterDataAuthorization(api.connection);
    tenantId = await createOrg(api.connection, { name: "租戶甲" });
    rootToken = await login(api, ROOT_ADMIN.account, ROOT_ADMIN.password);
    tenantToken = await createMasterDataOperator(api, api.connection, {
      orgId: tenantId,
      moduleKeys: GAME_MODULES,
      permissionKeys: [],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it.each(PROJECT_QUERIES)("$name", async ({ query, variables }) => {
    expect(
      await errorOf(api, rootToken, query, variables(String(tenantId))),
    ).toMatchObject({ code: "FORBIDDEN", reason: TENANT_ONLY_REASON });
  });

  it("站在租戶裡照常(同一個端點)", async () => {
    const data = await ok<{ lotteryGames: { totalCount: number } }>(
      api,
      tenantToken,
      PROJECT_QUERIES[0]?.query ?? "",
      { input: {} },
    );
    expect(data.lotteryGames.totalCount).toBe(0);
  });

  it("欄位選項不擋(根組織也會讀):走到端點自己的檢查,不是 TENANT_ONLY", async () => {
    // 這個測試庫沒有登記類別 → 端點自己的 VALIDATION_FAILED(categoryKey);重點是過了租戶守門
    expect(
      await errorOf(
        api,
        rootToken,
        `query { lotteryFieldOptions(categoryKey: "position") { totalCount } }`,
        {},
      ),
    ).toEqual({ code: "VALIDATION_FAILED", fields: ["categoryKey"] });
  });
});
