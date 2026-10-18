import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { Types } from "mongoose";

import {
  type AuthTestApp,
  ROOT_ADMIN,
  startAuthTestApp,
} from "../auth/test-support/auth-app";
import { createOrg, createUser } from "../auth/test-support/fixtures";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { createRole } from "../permission/test-support/fixtures";

const LOGIN = /* GraphQL */ `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
    }
  }
`;

const ORG_MEMBERS = /* GraphQL */ `
  query OrgMembers($orgId: ID!, $input: OrgMembersInput!) {
    orgMembers(orgId: $orgId, input: $input) {
      totalCount
      page
      pageSize
      items {
        id
        account
        name
        enabled
        otherOrgs {
          id
          name
        }
      }
    }
  }
`;

const ORG_MEMBER_CANDIDATES = /* GraphQL */ `
  query OrgMemberCandidates($orgId: ID!, $input: OrgMembersInput!) {
    orgMemberCandidates(orgId: $orgId, input: $input) {
      totalCount
      items {
        id
        account
        otherOrgs {
          id
          name
        }
      }
    }
  }
`;

const ADD_ORG_MEMBERS = /* GraphQL */ `
  mutation AddOrgMembers($input: AddOrgMembersInput!) {
    addOrgMembers(input: $input) {
      addedUserIds
      skippedUserIds
    }
  }
`;

interface LoginData {
  login: { accessToken: string };
}

interface MemberRow {
  id: string;
  account: string;
  name: string;
  enabled: boolean;
  otherOrgs: { id: string; name: string }[];
}

interface OrgMembersData {
  orgMembers: {
    totalCount: number;
    page: number;
    pageSize: number;
    items: MemberRow[];
  };
}

interface CandidatesData {
  orgMemberCandidates: {
    totalCount: number;
    items: { id: string; account: string; otherOrgs: { id: string }[] }[];
  };
}

interface AddData {
  addOrgMembers: { addedUserIds: string[]; skippedUserIds: string[] };
}

interface AuditRow {
  action: string;
  targetType?: string;
  targetId?: Types.ObjectId;
  after?: Record<string, unknown>;
}

const PASSWORD = ["org", "members", "test", "pass"].join("-");

const accountsOf = (rows: { account: string }[]): string[] =>
  rows.map((row) => row.account);

const sorted = (values: readonly string[]): string[] =>
  values.toSorted((left, right) => left.localeCompare(right));

const ORG_MANAGER_MODULE = "system.org-manager";
const VIEW_MEMBERS = `${ORG_MANAGER_MODULE}.view-members`;

/**
 * 組織詳情的「成員」頁籤(清單 / 候選 / 加入成員;TEST-07,對真 Nest + 真 MongoDB)。
 *
 * 規則正本:docs/modules/org-manager.md(權限表與 api 介面)、
 * docs/modules/user-manager.md「所屬組織」(加入的寫入與稽核沿用那一支)、
 * ADR-0005(管理範圍)、ADR-0003(所屬組織與授予資格)。
 */
describe("組織管理:成員頁籤(GraphQL 端點 + 真 MongoDB)", () => {
  let api: AuthTestApp;
  /** 租戶 A > A 部門一 > A 部門一之一;租戶 B 是管理範圍外的對照 */
  let tenantAId: Types.ObjectId;
  let deptOneId: Types.ObjectId;
  let deptOneSubId: Types.ObjectId;
  let tenantBId: Types.ObjectId;

  /** 租戶 A 的管理員(擁有組織 = 租戶頂層,持 `system.org-manager.*`) */
  let adminToken: string;
  /** 只持 `view-members`:看得到成員,但要不到候選、也加不了人 */
  let viewerToken: string;
  /** 只持 `view`(沒有成員頁籤的兩筆權限) */
  let plainToken: string;
  /** 租戶 B 的管理員:租戶 A 的一切對他而言都不存在 */
  let outsiderToken: string;

  /** A 部門一的既有成員 */
  let memberOneId: Types.ObjectId;
  /** 同時屬 A 部門一與租戶 B(管理範圍外的所屬組織不該露出來) */
  let memberTwoId: Types.ObjectId;
  /** 只屬 A 部門一之一:下層組織的成員不算 A 部門一的成員 */
  let memberSubId: Types.ObjectId;
  /** 只屬租戶頂層:A 部門一的候選 */
  let candidateId: Types.ObjectId;
  /** 只屬租戶 B:租戶 A 的管理員管不到他 */
  let outsiderUserId: Types.ObjectId;

  async function loginAccessToken(account: string): Promise<string> {
    const result = await api.graphql<LoginData>(LOGIN, {
      input: { account, password: PASSWORD },
    });
    expect(result.errors).toBeUndefined();
    const token = result.data?.login.accessToken;
    if (!token) {
      throw new Error(`${account} 登入沒有回 accessToken`);
    }
    return token;
  }

  async function membersOf(
    orgId: Types.ObjectId,
    input: Record<string, unknown> = {},
    token = adminToken,
  ): Promise<{
    data: OrgMembersData["orgMembers"] | undefined;
    code: string | undefined;
  }> {
    const result = await api.graphql<OrgMembersData>(
      ORG_MEMBERS,
      { orgId: String(orgId), input },
      { accessToken: token },
    );
    return {
      data: result.data?.orgMembers,
      code: result.errors?.[0]?.extensions?.code,
    };
  }

  async function candidatesOf(
    orgId: Types.ObjectId,
    input: Record<string, unknown> = {},
    token = adminToken,
  ): Promise<{
    data: CandidatesData["orgMemberCandidates"] | undefined;
    code: string | undefined;
  }> {
    const result = await api.graphql<CandidatesData>(
      ORG_MEMBER_CANDIDATES,
      { orgId: String(orgId), input },
      { accessToken: token },
    );
    return {
      data: result.data?.orgMemberCandidates,
      code: result.errors?.[0]?.extensions?.code,
    };
  }

  async function addMembers(
    orgId: Types.ObjectId,
    userIds: Types.ObjectId[],
    token = adminToken,
  ): Promise<{
    data: AddData["addOrgMembers"] | undefined;
    code: string | undefined;
  }> {
    const result = await api.graphql<AddData>(
      ADD_ORG_MEMBERS,
      { input: { orgId: String(orgId), userIds: userIds.map(String) } },
      { accessToken: token },
    );
    return {
      data: result.data?.addOrgMembers,
      code: result.errors?.[0]?.extensions?.code,
    };
  }

  /** 讀回 DB 的最終狀態(測試只信資料庫,不信回傳值)。 */
  async function orgIdsOfUser(userId: Types.ObjectId): Promise<string[]> {
    const links = await api.connection
      .collection("core_relationships")
      .find<{ firstId: Types.ObjectId }>({
        type: "org_user",
        secondId: userId,
        deletedAt: null,
      })
      .toArray();
    return links.map((link) => String(link.firstId));
  }

  async function addOrgAudits(userId: Types.ObjectId): Promise<AuditRow[]> {
    return api.connection
      .collection("audit_logs")
      .find<AuditRow>({ action: "user.add-org", targetId: userId })
      .toArray();
  }

  beforeAll(async () => {
    api = await startAuthTestApp("cookhome-test-org-members");

    tenantAId = await createOrg(api.connection, { name: "成員租戶A" });
    deptOneId = await createOrg(api.connection, {
      name: "成員 A 部門一",
      parentId: tenantAId,
    });
    deptOneSubId = await createOrg(api.connection, {
      name: "成員 A 部門一之一",
      parentId: deptOneId,
    });
    tenantBId = await createOrg(api.connection, { name: "成員租戶B" });

    const adminId = await createUser(api.connection, {
      account: "members-admin",
      password: PASSWORD,
      orgIds: [tenantAId],
    });
    await createRole(api.app, api.connection, {
      name: "成員租戶A 組織管理員",
      ownerOrgId: tenantAId,
      moduleKeys: [ORG_MANAGER_MODULE],
      permissionKeys: [`${ORG_MANAGER_MODULE}.*`],
      assignTo: [adminId],
    });
    adminToken = await loginAccessToken("members-admin");

    const viewerId = await createUser(api.connection, {
      account: "members-viewer",
      password: PASSWORD,
      orgIds: [tenantAId],
    });
    await createRole(api.app, api.connection, {
      name: "成員租戶A 成員檢視者",
      ownerOrgId: tenantAId,
      moduleKeys: [ORG_MANAGER_MODULE],
      permissionKeys: [VIEW_MEMBERS],
      assignTo: [viewerId],
    });
    viewerToken = await loginAccessToken("members-viewer");

    const plainId = await createUser(api.connection, {
      account: "members-plain",
      password: PASSWORD,
      orgIds: [tenantAId],
    });
    await createRole(api.app, api.connection, {
      name: "成員租戶A 組織檢視者",
      ownerOrgId: tenantAId,
      moduleKeys: [ORG_MANAGER_MODULE],
      permissionKeys: [`${ORG_MANAGER_MODULE}.view`],
      assignTo: [plainId],
    });
    plainToken = await loginAccessToken("members-plain");

    const outsiderAdminId = await createUser(api.connection, {
      account: "members-outsider-admin",
      password: PASSWORD,
      orgIds: [tenantBId],
    });
    await createRole(api.app, api.connection, {
      name: "成員租戶B 組織管理員",
      ownerOrgId: tenantBId,
      moduleKeys: [ORG_MANAGER_MODULE],
      permissionKeys: [`${ORG_MANAGER_MODULE}.*`],
      assignTo: [outsiderAdminId],
    });
    outsiderToken = await loginAccessToken("members-outsider-admin");

    memberOneId = await createUser(api.connection, {
      account: "members-one",
      password: PASSWORD,
      orgIds: [deptOneId],
    });
    memberTwoId = await createUser(api.connection, {
      account: "members-two",
      password: PASSWORD,
      orgIds: [deptOneId, tenantBId],
    });
    memberSubId = await createUser(api.connection, {
      account: "members-sub",
      password: PASSWORD,
      orgIds: [deptOneSubId],
    });
    candidateId = await createUser(api.connection, {
      account: "members-candidate",
      password: PASSWORD,
      orgIds: [tenantAId],
    });
    outsiderUserId = await createUser(api.connection, {
      account: "members-outsider",
      password: PASSWORD,
      orgIds: [tenantBId],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await api.close();
  }, HOOK_TIMEOUT_MS);

  describe("orgMembers:這個組織自己的成員", () => {
    it("只列直接成員(下層組織的成員不算),分頁參數原樣回傳", async () => {
      const { data } = await membersOf(deptOneId, { page: 1, pageSize: 10 });

      expect(sorted(accountsOf(data?.items ?? []))).toEqual([
        "members-one",
        "members-two",
      ]);
      expect(data?.totalCount).toBe(2);
      expect(data).toMatchObject({ page: 1, pageSize: 10 });
      // 下層組織的成員要去使用者管理的 users(那裡才是整棵子樹)
      expect(accountsOf(data?.items ?? [])).not.toContain("members-sub");
    });

    it("otherOrgs 只列本組織以外、且在管理範圍內的所屬組織", async () => {
      const { data } = await membersOf(deptOneId);
      const two = data?.items.find((row) => row.account === "members-two");

      // 租戶 B 在管理範圍外 → 不露名稱也不露 id(本組織 A 部門一本來就不列)
      expect(two?.otherOrgs).toEqual([]);

      await addMembers(tenantAId, [memberTwoId]);
      const after = await membersOf(deptOneId);
      expect(
        after.data?.items.find((row) => row.account === "members-two")
          ?.otherOrgs,
      ).toEqual([{ id: String(tenantAId), name: "成員租戶A" }]);
    });

    it("關鍵字比對姓名 / 帳號 / Email(不分大小寫的部分比對)", async () => {
      const { data } = await membersOf(deptOneId, { keyword: "MEMBERS-ONE" });

      expect(accountsOf(data?.items ?? [])).toEqual(["members-one"]);
      expect(data?.totalCount).toBe(1);
    });

    it("管理範圍外的組織視為不存在:NOT_FOUND", async () => {
      const { data, code } = await membersOf(
        deptOneId,
        {},
        // 租戶 B 的管理員看不到租戶 A 的任何組織
        outsiderToken,
      );

      expect(data).toBeUndefined();
      expect(code).toBe("NOT_FOUND");
    });

    it("沒有 view-members 權限:FORBIDDEN(只持組織管理的檢視權不夠)", async () => {
      const { code } = await membersOf(deptOneId, {}, plainToken);

      expect(code).toBe("FORBIDDEN");
    });

    it("只持 view-members 也看得到成員(頁籤與加入是兩筆權限)", async () => {
      const { data, code } = await membersOf(deptOneId, {}, viewerToken);

      expect(code).toBeUndefined();
      expect(accountsOf(data?.items ?? [])).toContain("members-one");
    });
  });

  describe("orgMemberCandidates:還沒加入的可見使用者", () => {
    it("列管理範圍內、尚未加入這個組織的人;已是成員的排除", async () => {
      const { data } = await candidatesOf(deptOneId, { pageSize: 100 });
      const ids = (data?.items ?? []).map((row) => row.id);

      expect(ids).toContain(String(candidateId));
      expect(ids).not.toContain(String(memberOneId));
      // 管理範圍外的人不是候選(租戶 B 的使用者)
      expect(ids).not.toContain(String(outsiderUserId));
    });

    it("守在 add-members 底下:只持 view-members 者拿不到候選(FORBIDDEN)", async () => {
      const { code } = await candidatesOf(deptOneId, {}, viewerToken);

      expect(code).toBe("FORBIDDEN");
    });
  });

  describe("addOrgMembers:加入成員", () => {
    it("加進去 = 使用者多一筆所屬組織,並留下 user.add-org 稽核", async () => {
      const { data, code } = await addMembers(deptOneId, [candidateId]);

      expect(code).toBeUndefined();
      expect(data).toEqual({
        addedUserIds: [String(candidateId)],
        skippedUserIds: [],
      });
      expect(await orgIdsOfUser(candidateId)).toEqual(
        expect.arrayContaining([String(tenantAId), String(deptOneId)]),
      );
      const audits = await addOrgAudits(candidateId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        targetType: "user",
        after: { orgIds: [String(deptOneId)] },
      });
    });

    it("已經是成員的略過並回在 skippedUserIds(冪等,不報錯、不重複稽核)", async () => {
      const { data, code } = await addMembers(deptOneId, [
        candidateId,
        memberOneId,
      ]);

      expect(code).toBeUndefined();
      expect(data?.addedUserIds).toEqual([]);
      expect(sorted(data?.skippedUserIds ?? [])).toEqual(
        sorted([String(candidateId), String(memberOneId)]),
      );
      // 上一個案子留下的那一筆還是唯一一筆
      expect(await addOrgAudits(candidateId)).toHaveLength(1);
    });

    it("管理範圍外的使用者視為不存在:NOT_FOUND,而且一個都不寫入", async () => {
      const before = await orgIdsOfUser(memberSubId);
      const { code } = await addMembers(deptOneId, [
        memberSubId,
        outsiderUserId,
      ]);

      expect(code).toBe("NOT_FOUND");
      expect(await orgIdsOfUser(memberSubId)).toEqual(before);
    });

    it("管理範圍外的組織視為不存在:NOT_FOUND", async () => {
      const { code } = await addMembers(tenantBId, [candidateId]);

      expect(code).toBe("NOT_FOUND");
    });

    it("沒有 add-members 權限:FORBIDDEN(只持 view-members 者加不了人)", async () => {
      const { code } = await addMembers(deptOneId, [memberSubId], viewerToken);

      expect(code).toBe("FORBIDDEN");
    });

    it("root 對任何租戶都做得到(管理範圍是全部)", async () => {
      const login = await api.graphql<LoginData>(LOGIN, {
        input: { account: ROOT_ADMIN.account, password: ROOT_ADMIN.password },
      });
      const rootToken = login.data?.login.accessToken;
      const { data, code } = await addMembers(
        deptOneSubId,
        [outsiderUserId],
        rootToken ?? "",
      );

      expect(code).toBeUndefined();
      expect(data?.addedUserIds).toEqual([String(outsiderUserId)]);
    });
  });
});
