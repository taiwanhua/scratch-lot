import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { Types } from "mongoose";

import { AuditService } from "../audit/audit.service";
import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import {
  createOrg,
  createUser,
  setUserEnabled,
} from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { createRole } from "../permission/test-support/fixtures";
import { OrgManagersService } from "./org-managers.service";

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const ORG_MANAGERS = /* GraphQL */ `
  query OrgManagers($id: ID!) {
    org(id: $id) {
      id
      managers {
        id
        name
        account
        enabled
      }
    }
  }
`;

const SET_ORG_MANAGERS = /* GraphQL */ `
  mutation SetOrgManagers($input: SetOrgManagersInput!) {
    setOrgManagers(input: $input) {
      org {
        id
        managers {
          id
        }
      }
    }
  }
`;

const DELETE_ORG = /* GraphQL */ `
  mutation DeleteOrg($input: DeleteOrgInput!) {
    deleteOrg(input: $input) {
      success
    }
  }
`;

const CANDIDATES = /* GraphQL */ `
  query OrgManagerCandidates($orgId: ID!, $keyword: String) {
    orgManagerCandidates(orgId: $orgId, keyword: $keyword) {
      id
      account
    }
  }
`;

interface LoginData {
  login: { accessToken: string };
}

interface ManagersData {
  org: { id: string; managers: { id: string; account: string }[] };
}

interface SetManagersData {
  setOrgManagers: { org: { id: string; managers: { id: string }[] } };
}

interface CandidatesData {
  orgManagerCandidates: { id: string; account: string }[];
}

interface AuditRow {
  action: string;
  targetId?: Types.ObjectId;
  before?: { managerIds?: string[] };
  after?: { managerIds?: string[] };
}

const PASSWORD = ["managers", "test", "pass"].join("-");

/** 從 DI 取出主管解析(引擎在票 B 才掛上 GraphQL 端點;TEST-07 的第二個接縫)。 */
async function resolveManagersOf(
  api: AuthTestApp,
  tenantId: Types.ObjectId,
  applicantId: Types.ObjectId,
  orgId: Types.ObjectId,
  level: number,
): Promise<string[]> {
  const ids = await api.app
    .get(OrgManagersService)
    .resolveManagers(applicantId, orgId, tenantId, level);
  return ids.map(String);
}
const ORG_MANAGER_MODULE = "system.org-manager";

/**
 * 組織主管(`org_manager`;對真 Nest + 真 MongoDB):
 * `setOrgManagers` 整組取代與稽核、`org.managers`、候選人以租戶為界、權限守門,
 * 以及主管解析 `resolveManagers`(從提交組織往上、上界租戶、剔除申請人、只算啟用且仍在本租戶的人)。
 *
 * 組織樹:root ─┬─ 租戶 A ── 台北店 ── 廚房部
 *               └─ 租戶 B
 */
describe("組織主管(setOrgManagers / org.managers / resolveManagers)", () => {
  let api: AuthTestApp;
  let rootToken: string;
  let viewerToken: string;
  let tenantAId: Types.ObjectId;
  let storeId: Types.ObjectId;
  let kitchenId: Types.ObjectId;
  let tenantBId: Types.ObjectId;
  let wangId: Types.ObjectId;
  let viceId: Types.ObjectId;
  let bossId: Types.ObjectId;
  let mingId: Types.ObjectId;
  let outsiderId: Types.ObjectId;
  let disabledId: Types.ObjectId;

  async function loginAccessToken(account: string, password: string) {
    const result = await api.graphql<LoginData>(LOGIN, {
      input: { account, password },
    });
    const token = result.data?.login.accessToken;
    if (!token) {
      throw new Error(`login 失敗:${account}`);
    }
    return token;
  }

  function user(account: string, orgIds: Types.ObjectId[]) {
    return createUser(api.connection, { account, password: PASSWORD, orgIds });
  }

  async function setManagers(orgId: Types.ObjectId, userIds: Types.ObjectId[]) {
    return api.graphql<SetManagersData>(
      SET_ORG_MANAGERS,
      { input: { orgId: String(orgId), userIds: userIds.map(String) } },
      { accessToken: rootToken },
    );
  }

  async function setManagersOk(
    orgId: Types.ObjectId,
    userIds: Types.ObjectId[],
  ): Promise<void> {
    const result = await setManagers(orgId, userIds);
    expect(result.errors).toBeUndefined();
  }

  function auditRows(orgId: Types.ObjectId): Promise<AuditRow[]> {
    return api.connection
      .collection("audit_logs")
      .find<AuditRow>({ action: "org.set-managers", targetId: orgId })
      .toArray();
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-org-managers");
    rootToken = await loginAccessToken(ROOT_ADMIN.account, ROOT_ADMIN.password);
    tenantAId = await createOrg(api.connection, { name: "租戶 A" });
    storeId = await createOrg(api.connection, {
      name: "台北店",
      parentId: tenantAId,
    });
    kitchenId = await createOrg(api.connection, {
      name: "廚房部",
      parentId: storeId,
    });
    tenantBId = await createOrg(api.connection, { name: "租戶 B" });
    wangId = await user("mgr-wang", [storeId]);
    viceId = await user("mgr-vice", [kitchenId]);
    bossId = await user("mgr-boss", [tenantAId]);
    mingId = await user("mgr-ming", [kitchenId]);
    disabledId = await user("mgr-disabled", [storeId]);
    await setUserEnabled(api.connection, disabledId, false);
    outsiderId = await user("mgr-outsider", [tenantBId]);

    const viewerId = await user("mgr-viewer", [tenantAId]);
    await createRole(api.app, api.connection, {
      name: "租戶A 組織檢視者",
      ownerOrgId: tenantAId,
      moduleKeys: [ORG_MANAGER_MODULE],
      permissionKeys: [`${ORG_MANAGER_MODULE}.view`],
      assignTo: [viewerId],
    });
    viewerToken = await loginAccessToken("mgr-viewer", PASSWORD);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  it("setOrgManagers 設本租戶的使用者(可多位、不必是該組織成員);org.managers 讀得回來;寫稽核 org.set-managers", async () => {
    const result = await setManagers(storeId, [wangId, viceId]);
    expect(result.errors).toBeUndefined();
    expect(
      result.data?.setOrgManagers.org.managers.map((manager) => manager.id),
    ).toEqual([String(wangId), String(viceId)]);

    const read = await api.graphql<ManagersData>(
      ORG_MANAGERS,
      { id: String(storeId) },
      { accessToken: viewerToken },
    );
    expect(read.errors).toBeUndefined();
    expect(read.data?.org.managers.map((manager) => manager.account)).toEqual([
      "mgr-wang",
      "mgr-vice",
    ]);

    const rows = await auditRows(storeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      before: { managerIds: [] },
      after: { managerIds: [String(wangId), String(viceId)] },
    });
  });

  it("整組取代:不在名單裡的既有主管被移除;名單沒變不寫也不留稽核", async () => {
    await setManagersOk(storeId, [wangId]);
    const links = await api.connection
      .collection("core_relationships")
      .find({ type: "org_manager", firstId: storeId })
      .toArray();
    expect(links.map((link) => String(link.secondId))).toEqual([
      String(wangId),
    ]);
    await setManagersOk(storeId, [wangId, wangId]);
    const rows = await auditRows(storeId);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      before: { managerIds: [String(wangId), String(viceId)] },
      after: { managerIds: [String(wangId)] },
    });
  });

  it("別租戶的使用者不能當主管;根組織不能設主管(VALIDATION_FAILED)", async () => {
    const outsider = await setManagers(storeId, [outsiderId]);
    expect(outsider.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
    const root = await api.connection
      .collection("orgs")
      .findOne<{ _id: Types.ObjectId }>({ parentId: null });
    const rootResult = await setManagers(root?._id ?? tenantAId, [wangId]);
    expect(rootResult.errors?.[0]?.extensions?.code).toBe("VALIDATION_FAILED");
  });

  it("沒有組織編輯權限 → FORBIDDEN(只有檢視權的人讀得到主管,改不了)", async () => {
    const result = await api.graphql(
      SET_ORG_MANAGERS,
      { input: { orgId: String(storeId), userIds: [] } },
      { accessToken: viewerToken },
    );
    expect(result.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });

  it("主管候選人:只列該組織所屬租戶裡啟用中的使用者,可用關鍵字收斂", async () => {
    const result = await api.graphql<CandidatesData>(
      CANDIDATES,
      { orgId: String(kitchenId) },
      { accessToken: rootToken },
    );
    expect(result.errors).toBeUndefined();
    const accounts = result.data?.orgManagerCandidates.map(
      (candidate) => candidate.account,
    );
    expect(accounts).toEqual(
      expect.arrayContaining(["mgr-wang", "mgr-vice", "mgr-boss", "mgr-ming"]),
    );
    expect(accounts).not.toContain("mgr-outsider");
    expect(accounts).not.toContain("mgr-disabled");
    const filtered = await api.graphql<CandidatesData>(
      CANDIDATES,
      { orgId: String(kitchenId), keyword: "boss" },
      { accessToken: rootToken },
    );
    expect(
      filtered.data?.orgManagerCandidates.map((candidate) => candidate.account),
    ).toEqual(["mgr-boss"]);
  });

  it("刪除組織時一併移除它的主管關聯(稽核的 before 記下被移除的主管)", async () => {
    const emptyOrgId = await createOrg(api.connection, {
      name: "待刪分店",
      parentId: tenantAId,
    });
    await setManagersOk(emptyOrgId, [wangId]);
    const result = await api.graphql(
      DELETE_ORG,
      { input: { id: String(emptyOrgId) } },
      { accessToken: rootToken },
    );
    expect(result.errors).toBeUndefined();
    await expect(
      api.connection
        .collection("core_relationships")
        .countDocuments({ type: "org_manager", firstId: emptyOrgId }),
    ).resolves.toBe(0);
    const audit = await api.connection
      .collection("audit_logs")
      .findOne<AuditRow>({ action: "org.delete", targetId: emptyOrgId });
    expect(audit?.before?.managerIds).toEqual([String(wangId)]);
  });

  describe("resolveManagers(TEST-07 例外:還沒有 GraphQL 端點,引擎在票 B 才掛上)", () => {
    beforeAll(async () => {
      await setManagersOk(storeId, [wangId]);
      await setManagersOk(tenantAId, [bossId]);
    }, HOOK_TIMEOUT_MS);

    it("從提交所屬組織往上找第一組主管;level 2 再往上一組;上界是租戶頂層", async () => {
      await expect(
        resolveManagersOf(api, tenantAId, mingId, kitchenId, 1),
      ).resolves.toEqual([String(wangId)]);
      await expect(
        resolveManagersOf(api, tenantAId, mingId, kitchenId, 2),
      ).resolves.toEqual([String(bossId)]);
      await expect(
        resolveManagersOf(api, tenantAId, mingId, kitchenId, 3),
      ).resolves.toEqual([]);
    });

    it("申請人自己是那一層的唯一主管 → 剔除後為空,往上一層", async () => {
      await expect(
        resolveManagersOf(api, tenantAId, wangId, kitchenId, 1),
      ).resolves.toEqual([String(bossId)]);
    });

    it("停用的主管、已移出本租戶的主管不算", async () => {
      await setManagersOk(kitchenId, [disabledId]);
      await expect(
        resolveManagersOf(api, tenantAId, mingId, kitchenId, 1),
      ).resolves.toEqual([String(wangId)]);
      // 王經理移出租戶(拿掉所有 org_user)→ 台北店這層視同沒有主管
      await api.connection
        .collection("core_relationships")
        .deleteMany({ type: "org_user", secondId: wangId });
      await expect(
        resolveManagersOf(api, tenantAId, mingId, kitchenId, 1),
      ).resolves.toEqual([String(bossId)]);
    });

    it("提交組織不在該租戶底下 → 空(不往租戶外找)", async () => {
      await expect(
        resolveManagersOf(api, tenantAId, mingId, tenantBId, 1),
      ).resolves.toEqual([]);
    });
  });

  it("交易(TX-01):稽核寫入失敗 → 主管名單的增減整個回復", async () => {
    const orgId = await createOrg(api.connection, {
      name: "回復用的部門",
      parentId: tenantAId,
    });
    await setManagersOk(orgId, [bossId]);
    const audit = jest
      .spyOn(api.app.get(AuditService), "record")
      .mockRejectedValueOnce(new Error("模擬稽核寫入失敗"));
    try {
      const result = await setManagers(orgId, [mingId]);

      expect(result.errors).toBeDefined();
      expect(audit).toHaveBeenCalledTimes(1);
    } finally {
      audit.mockRestore();
    }
    const links = await api.connection
      .collection("core_relationships")
      .find<{ secondId: Types.ObjectId }>({
        type: "org_manager",
        firstId: orgId,
      })
      .toArray();
    expect(links.map((link) => String(link.secondId))).toEqual([
      String(bossId),
    ]);
  });
});
