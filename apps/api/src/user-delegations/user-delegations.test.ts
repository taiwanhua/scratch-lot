import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Types } from "mongoose";

import {
  type AuthTestApp,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg, createUser } from "../auth/test-support/fixtures";
import {
  FORM_TEST_TIMEOUT_MS,
  PASSWORD,
  login,
  ok,
} from "../forms/test-support/form-fixtures";

jest.setTimeout(FORM_TEST_TIMEOUT_MS);

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const MY_DELEGATIONS = /* GraphQL */ `
  query MyDelegations($input: MyDelegationsInput!) {
    myDelegations(input: $input) {
      items {
        id
        delegate {
          id
          name
        }
        startAt
        endAt
        note
        status
      }
      totalCount
    }
  }
`;

const CANDIDATES = /* GraphQL */ `
  query MyDelegateCandidates($input: MyDelegateCandidatesInput!) {
    myDelegateCandidates(input: $input) {
      items {
        id
        name
        account
      }
      totalCount
    }
  }
`;

const CREATE = /* GraphQL */ `
  mutation CreateMyDelegation($input: CreateMyDelegationInput!) {
    createMyDelegation(input: $input) {
      delegation {
        id
        delegate {
          id
        }
        note
        status
      }
    }
  }
`;

const DELETE = /* GraphQL */ `
  mutation DeleteMyDelegation($input: DeleteMyDelegationInput!) {
    deleteMyDelegation(input: $input) {
      id
    }
  }
`;

interface Someone {
  userId: Types.ObjectId;
  account: string;
  token: string;
}

interface GraphQLResult {
  data?: unknown;
  errors?: { extensions?: Record<string, unknown> }[];
}

let sequence = 0;

/** 一位**沒有任何角色**的使用者(個人設定不分配給角色,照樣能設代理)。 */
async function someone(
  api: AuthTestApp,
  orgId: Types.ObjectId,
  enabled = true,
): Promise<Someone> {
  sequence += 1;
  const account = `delegation-user-${String(sequence)}`;
  const userId = await createUser(api.connection, {
    account,
    password: PASSWORD,
    orgIds: [orgId],
  });
  const token = await login(api, account);
  if (!enabled) {
    await api.connection
      .collection("users")
      .updateOne({ _id: userId }, { $set: { enabled: false } });
  }
  return { userId, account, token };
}

function period(fromNowMs: number, lengthMs: number) {
  const startAt = new Date(Date.now() + fromNowMs);
  return {
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + lengthMs).toISOString(),
  };
}

function rejection(result: GraphQLResult): {
  code: unknown;
  reason: unknown;
} {
  const extensions = result.errors?.[0]?.extensions ?? {};
  return { code: extensions.code, reason: extensions.reason };
}

/**
 * 代理設定(《底座規格》3.7 B15「誰能設定」與情況表;真 Mongo):只讀寫自己的、所有登入者都能用。
 * 租戶「店家」下兩個分店的人都算本租戶;另一個租戶的人不能當代理人。
 */
describe("代理設定(myDelegations / createMyDelegation …)", () => {
  let api: AuthTestApp;
  let tenant: Types.ObjectId;
  let branch: Types.ObjectId;
  let other: Types.ObjectId;

  async function create(
    who: Someone,
    delegate: Someone,
    when: { startAt: string; endAt: string },
    note: string | null = null,
  ): Promise<GraphQLResult> {
    return api.graphql(
      CREATE,
      {
        input: { delegateUserId: String(delegate.userId), ...when, note },
      },
      { accessToken: who.token },
    );
  }

  beforeAll(async () => {
    api = await startAuthTestApp("user_delegations");
    tenant = await createOrg(api.connection, { name: "店家" });
    branch = await createOrg(api.connection, {
      name: "台北店",
      parentId: tenant,
    });
    other = await createOrg(api.connection, { name: "別家" });
  });

  afterAll(async () => {
    await api.close();
  });

  it("角色沒有被分配任何模組的使用者:照常讀到自己的代理清單並可設定(代理人在同一最上層組織的下層也可以)", async () => {
    const me = await someone(api, tenant);
    const deputy = await someone(api, branch);
    const created = await create(
      me,
      deputy,
      period(-HOUR_MS, DAY_MS),
      " 出國 ",
    );
    expect(created.errors).toBeUndefined();
    const data = await ok<{
      myDelegations: {
        items: {
          delegate: { id: string; name: string };
          note: string | null;
          status: string;
        }[];
        totalCount: number;
      };
    }>(api, me.token, MY_DELEGATIONS, { input: {} });
    expect(data.myDelegations.totalCount).toBe(1);
    expect(data.myDelegations.items[0]).toMatchObject({
      delegate: { id: String(deputy.userId), name: deputy.account },
      note: "出國",
      status: "ACTIVE",
    });
  });

  it("清單只有自己的;狀態依時間算(未開始 / 代理中 / 已結束)", async () => {
    const me = await someone(api, tenant);
    const someoneElse = await someone(api, tenant);
    const deputy = await someone(api, tenant);
    await create(someoneElse, deputy, period(-HOUR_MS, DAY_MS));
    await create(me, deputy, period(2 * DAY_MS, DAY_MS));
    await create(me, deputy, period(-HOUR_MS, DAY_MS));
    await api.connection.collection("user_delegations").insertOne({
      userId: me.userId,
      delegateUserId: deputy.userId,
      startAt: new Date(Date.now() - 10 * DAY_MS),
      endAt: new Date(Date.now() - 9 * DAY_MS),
      note: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: me.userId,
      updatedBy: me.userId,
      deletedAt: null,
    });
    const data = await ok<{
      myDelegations: { items: { status: string }[]; totalCount: number };
    }>(api, me.token, MY_DELEGATIONS, { input: {} });
    expect(data.myDelegations.totalCount).toBe(3);
    // 依開始時間新到舊
    expect(data.myDelegations.items.map((item) => item.status)).toEqual([
      "UPCOMING",
      "ACTIVE",
      "ENDED",
    ]);
  });

  it("新增和自己既有代理期間重疊的代理 → VALIDATION_FAILED / DELEGATION_OVERLAP;接在後面(迄 = 起)可以", async () => {
    const me = await someone(api, tenant);
    const deputy = await someone(api, tenant);
    const first = period(DAY_MS, 3 * DAY_MS);
    const created = await create(me, deputy, first);
    expect(created.errors).toBeUndefined();
    expect(
      rejection(await create(me, deputy, period(2 * DAY_MS, 5 * DAY_MS))),
    ).toEqual({ code: "VALIDATION_FAILED", reason: "DELEGATION_OVERLAP" });
    const next = {
      startAt: first.endAt,
      endAt: new Date(Date.parse(first.endAt) + DAY_MS).toISOString(),
    };
    const adjacent = await create(me, deputy, next);
    expect(adjacent.errors).toBeUndefined();
  });

  it("代理人 = 自己 → VALIDATION_FAILED / SELF_DELEGATION", async () => {
    const me = await someone(api, tenant);
    expect(rejection(await create(me, me, period(0, DAY_MS)))).toEqual({
      code: "VALIDATION_FAILED",
      reason: "SELF_DELEGATION",
    });
  });

  it("代理人停用或不在本最上層組織 → VALIDATION_FAILED / DELEGATE_NOT_ELIGIBLE", async () => {
    const me = await someone(api, tenant);
    const disabled = await someone(api, tenant, false);
    const outsider = await someone(api, other);
    expect(rejection(await create(me, disabled, period(0, DAY_MS)))).toEqual({
      code: "VALIDATION_FAILED",
      reason: "DELEGATE_NOT_ELIGIBLE",
    });
    expect(rejection(await create(me, outsider, period(0, DAY_MS)))).toEqual({
      code: "VALIDATION_FAILED",
      reason: "DELEGATE_NOT_ELIGIBLE",
    });
  });

  it("迄 <= 起,或迄已過 → VALIDATION_FAILED / INVALID_PERIOD", async () => {
    const me = await someone(api, tenant);
    const deputy = await someone(api, tenant);
    expect(rejection(await create(me, deputy, period(DAY_MS, 0)))).toEqual({
      code: "VALIDATION_FAILED",
      reason: "INVALID_PERIOD",
    });
    expect(
      rejection(await create(me, deputy, period(-3 * DAY_MS, DAY_MS))),
    ).toEqual({ code: "VALIDATION_FAILED", reason: "INVALID_PERIOD" });
  });

  it("替別人設定代理:沒有入口;刪別人的代理 → NOT_FOUND;沒有改結束日的端點", async () => {
    const me = await someone(api, tenant);
    const owner = await someone(api, tenant);
    const deputy = await someone(api, tenant);
    const created = (await create(owner, deputy, period(0, DAY_MS))) as {
      data?: { createMyDelegation: { delegation: { id: string } } };
    };
    const id = created.data?.createMyDelegation.delegation.id;
    const deleted = await api.graphql(
      DELETE,
      { input: { id } },
      { accessToken: me.token },
    );
    expect(rejection(deleted).code).toBe("NOT_FOUND");
  });

  it("進行中的代理可以刪除(要延長就刪除後重新設定,同一期間可以再新增)", async () => {
    const me = await someone(api, tenant);
    const deputy = await someone(api, tenant);
    const created = (await create(me, deputy, period(-HOUR_MS, DAY_MS))) as {
      data?: { createMyDelegation: { delegation: { id: string } } };
    };
    const id = created.data?.createMyDelegation.delegation.id;
    await ok(api, me.token, DELETE, { input: { id } });
    const after = await ok<{ myDelegations: { totalCount: number } }>(
      api,
      me.token,
      MY_DELEGATIONS,
      { input: {} },
    );
    expect(after.myDelegations.totalCount).toBe(0);
    const longer = await create(me, deputy, period(-HOUR_MS, 3 * DAY_MS));
    expect(longer.errors).toBeUndefined();
  });

  it("沒有改結束日的端點(延長 = 刪除後重新設定)", async () => {
    const me = await someone(api, tenant);
    const result = await api.graphql(
      /* GraphQL */ `
        mutation {
          updateMyDelegation(
            input: { id: "x", endAt: "2026-01-01T00:00:00Z" }
          ) {
            delegation {
              id
            }
          }
        }
      `,
      {},
      { accessToken: me.token },
    );
    expect(result.errors).toBeDefined();
  });

  it("已結束的代理唯讀:刪 → VALIDATION_FAILED / DELEGATION_ENDED,紀錄保留", async () => {
    const me = await someone(api, tenant);
    const deputy = await someone(api, tenant);
    const { insertedId } = await api.connection
      .collection("user_delegations")
      .insertOne({
        userId: me.userId,
        delegateUserId: deputy.userId,
        startAt: new Date(Date.now() - 5 * DAY_MS),
        endAt: new Date(Date.now() - 4 * DAY_MS),
        note: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: me.userId,
        updatedBy: me.userId,
        deletedAt: null,
      });
    const id = String(insertedId);
    expect(
      rejection(
        await api.graphql(DELETE, { input: { id } }, { accessToken: me.token }),
      ),
    ).toEqual({ code: "VALIDATION_FAILED", reason: "DELEGATION_ENDED" });
    const after = await ok<{ myDelegations: { totalCount: number } }>(
      api,
      me.token,
      MY_DELEGATIONS,
      { input: {} },
    );
    expect(after.myDelegations.totalCount).toBe(1);
  });

  it("可選的代理人:同一最上層組織、啟用中、不含自己;關鍵字比對帳號", async () => {
    const me = await someone(api, tenant);
    const deputy = await someone(api, branch);
    await someone(api, tenant, false);
    await someone(api, other);
    const data = await ok<{
      myDelegateCandidates: { items: { id: string; account: string }[] };
    }>(api, me.token, CANDIDATES, { input: { pageSize: 100 } });
    const ids = data.myDelegateCandidates.items.map((item) => item.id);
    expect(ids).toContain(String(deputy.userId));
    expect(ids).not.toContain(String(me.userId));
    const enabledIds = await api.connection
      .collection("users")
      .find({ enabled: false })
      .map((user) => String(user._id))
      .toArray();
    expect(ids.some((id) => enabledIds.includes(id))).toBe(false);
    const filtered = await ok<{
      myDelegateCandidates: { items: { id: string }[]; totalCount: number };
    }>(api, me.token, CANDIDATES, { input: { keyword: deputy.account } });
    expect(filtered.myDelegateCandidates.items).toEqual([
      {
        id: String(deputy.userId),
        name: deputy.account,
        account: deputy.account,
      },
    ]);
  });
});
