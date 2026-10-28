import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { type Connection, Types } from "mongoose";

import { AuditService } from "../audit/audit.service";
import { createOrg, createUser } from "../auth/test-support/fixtures";
import {
  countDbCommands,
  expectDbCommandsAtMost,
} from "../database/test-support/db-commands";
import { HOOK_TIMEOUT_MS } from "../database/test-support/mongo-connection";
import { createRole } from "../permission/test-support/fixtures";
import {
  type Manager,
  PASSWORD,
  type RolesWorld,
  createManager,
  createMember,
  latestAudit,
  login,
  nextAccount,
  startRolesWorld,
} from "./roles-test-support";

const ROLE_USERS = /* GraphQL */ `
  query RoleUsers($roleId: ID!, $input: RoleUsersInput!) {
    roleUsers(roleId: $roleId, input: $input) {
      role {
        id
        userCount
      }
      totalCount
      page
      pageSize
      items {
        id
        account
        name
        email
        enabled
        outOfScope
        ownerProtected
        orgs {
          id
          name
        }
      }
    }
  }
`;

const ROLE_USER_CANDIDATES = /* GraphQL */ `
  query RoleUserCandidates($roleId: ID!, $input: RoleUserCandidatesInput!) {
    roleUserCandidates(roleId: $roleId, input: $input) {
      totalCount
      page
      pageSize
      items {
        id
        account
        name
        email
        enabled
        eligible
        orgs {
          id
          name
        }
      }
    }
  }
`;

const GRANT_ROLE_USERS = /* GraphQL */ `
  mutation GrantRoleUsers($input: GrantRoleUsersInput!) {
    grantRoleUsers(input: $input) {
      totalCount
      items {
        id
        outOfScope
      }
    }
  }
`;

const REVOKE_ROLE_USERS = /* GraphQL */ `
  mutation RevokeRoleUsers($input: RevokeRoleUsersInput!) {
    revokeRoleUsers(input: $input) {
      totalCount
      items {
        id
      }
    }
  }
`;

interface RoleUserRow {
  id: string;
  account: string;
  name: string;
  email: string;
  enabled: boolean;
  outOfScope: boolean;
  ownerProtected: boolean;
  orgs: { id: string; name: string }[];
}

interface RoleUsersData {
  roleUsers: {
    role: { id: string; userCount: number };
    totalCount: number;
    page: number;
    pageSize: number;
    items: RoleUserRow[];
  };
}

interface GrantData {
  grantRoleUsers: {
    totalCount: number;
    items: { id: string; outOfScope: boolean }[];
  };
}

interface RevokeData {
  revokeRoleUsers: { totalCount: number; items: { id: string }[] };
}

interface CandidateRow {
  id: string;
  account: string;
  name: string;
  email: string;
  enabled: boolean;
  eligible: boolean;
  orgs: { id: string; name: string }[];
}

interface CandidatesData {
  roleUserCandidates: {
    totalCount: number;
    page: number;
    pageSize: number;
    items: CandidateRow[];
  };
}

/**
 * 分配使用者:候選規則、「組織外」標記、擁有者保護(TEST-07,對真 MongoDB)。
 * 規則正本:ADR-0003「被授予角色的資格」/「從組織移除使用者」、ADR-0009 擁有者保護。
 */
describe("角色管理:分配使用者(GraphQL 端點 + 真 MongoDB)", () => {
  let world: RolesWorld;
  let connection: Connection;
  let manager: Manager;

  beforeAll(async () => {
    world = await startRolesWorld("cookhome-test-role-users");
    connection = world.connection;
    manager = await createManager(world, {
      orgIds: [world.tenantA],
      ownerOrgId: world.tenantA,
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await world.api.close();
  }, HOOK_TIMEOUT_MS);

  async function listUsers(
    roleId: Types.ObjectId,
    input: Record<string, unknown> = {},
    token = manager.token,
  ): Promise<RoleUsersData["roleUsers"]> {
    const result = await world.api.graphql<RoleUsersData>(
      ROLE_USERS,
      { roleId: String(roleId), input },
      { accessToken: token },
    );
    expect(result.errors).toBeUndefined();
    if (!result.data) {
      throw new Error("roleUsers 沒有回資料");
    }
    return result.data.roleUsers;
  }

  async function candidatesOf(
    roleId: Types.ObjectId,
    input: Record<string, unknown> = {},
    token = manager.token,
  ): Promise<{
    data: CandidatesData["roleUserCandidates"] | undefined;
    code: string | undefined;
  }> {
    const result = await world.api.graphql<CandidatesData>(
      ROLE_USER_CANDIDATES,
      { roleId: String(roleId), input },
      { accessToken: token },
    );
    return {
      data: result.data?.roleUserCandidates,
      code: result.errors?.[0]?.extensions?.code,
    };
  }

  async function grant(
    roleId: Types.ObjectId,
    userIds: Types.ObjectId[],
    token = manager.token,
  ): Promise<{ data: GrantData | null; code: string | undefined }> {
    const result = await world.api.graphql<GrantData>(
      GRANT_ROLE_USERS,
      { input: { roleId: String(roleId), userIds: userIds.map(String) } },
      { accessToken: token },
    );
    return { data: result.data, code: result.errors?.[0]?.extensions?.code };
  }

  async function revoke(
    roleId: Types.ObjectId,
    userIds: Types.ObjectId[],
    token = manager.token,
  ): Promise<{ data: RevokeData | null; code: string | undefined }> {
    const result = await world.api.graphql<RevokeData>(
      REVOKE_ROLE_USERS,
      { input: { roleId: String(roleId), userIds: userIds.map(String) } },
      { accessToken: token },
    );
    return { data: result.data, code: result.errors?.[0]?.extensions?.code };
  }

  async function holderIdsOf(roleId: Types.ObjectId): Promise<string[]> {
    const links = await connection
      .collection("core_relationships")
      .find<{ firstId: Types.ObjectId }>({
        type: "user_role",
        secondId: roleId,
      })
      .toArray();
    return links.map((link) => String(link.firstId));
  }

  describe("加入使用者:候選 = 所屬組織在擁有組織子樹內(ADR-0003)", () => {
    it("子樹內的使用者可加入(下層組織的人可被授予上層組織的角色)", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "部門一的角色",
        ownerOrgId: world.deptOne,
      });
      // 小組一在部門一底下 ⇒ 有資格
      const teamMember = await createMember(world, [world.teamOne]);
      const { data, code } = await grant(roleId, [teamMember]);
      expect(code).toBeUndefined();
      expect(data?.grantRoleUsers.items.map((row) => row.id)).toEqual([
        String(teamMember),
      ]);
      expect(await holderIdsOf(roleId)).toEqual([String(teamMember)]);

      const audit = await latestAudit(world, "role.grant-user", roleId);
      expect(audit?.after?.userIds).toEqual([String(teamMember)]);
    });

    it("子樹外的使用者 → USER_NOT_ELIGIBLE,且一個都不寫入", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "部門一的另一個角色",
        ownerOrgId: world.deptOne,
      });
      const eligible = await createMember(world, [world.deptOne]);
      // 部門二不在部門一的子樹內 ⇒ 沒資格
      const ineligible = await createMember(world, [world.deptTwo]);
      const { code } = await grant(roleId, [eligible, ineligible]);
      expect(code).toBe("USER_NOT_ELIGIBLE");
      expect(await holderIdsOf(roleId)).toEqual([]);
    });

    it("上層組織的人不能被授予下層組織的角色(子樹是往下,不是往上)", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "小組一的角色",
        ownerOrgId: world.teamOne,
      });
      const deptMember = await createMember(world, [world.deptOne]);
      const { code } = await grant(roleId, [deptMember]);
      expect(code).toBe("USER_NOT_ELIGIBLE");
    });

    it("已經持有的人重送不報錯(冪等),不重複寫入也不重複記稽核", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "冪等測試角色",
        ownerOrgId: world.deptOne,
      });
      const member = await createMember(world, [world.deptOne]);
      await grant(roleId, [member]);
      const countBefore = await connection
        .collection("audit_logs")
        .countDocuments({ action: "role.grant-user", targetId: roleId });

      const { code } = await grant(roleId, [member]);
      expect(code).toBeUndefined();
      expect(await holderIdsOf(roleId)).toEqual([String(member)]);
      const countAfter = await connection
        .collection("audit_logs")
        .countDocuments({ action: "role.grant-user", targetId: roleId });
      expect(countAfter).toBe(countBefore);
    });

    it("角色在管理範圍外 → NOT_FOUND(不透露存在與否)", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "租戶乙的角色",
        ownerOrgId: world.tenantB,
      });
      const member = await createMember(world, [world.deptOfB]);
      const { code } = await grant(roleId, [member]);
      expect(code).toBe("NOT_FOUND");
    });
  });

  describe("清單:「組織外」標記與分頁", () => {
    it("失去子樹支撐的持有者標 outOfScope,授予照常有效(ADR-0003)", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "組織外測試角色",
        ownerOrgId: world.deptOne,
      });
      const inside = await createMember(world, [world.deptOne]);
      const outside = await createMember(world, [world.deptTwo]);
      await grant(roleId, [inside]);
      // 直接寫入一筆「組織外」的既有授予(模擬被移出組織後保留的那種)
      await connection.collection("core_relationships").insertOne({
        type: "user_role",
        firstId: outside,
        secondId: roleId,
        thirdId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      });

      const page = await listUsers(roleId, { pageSize: 50 });
      expect(page.totalCount).toBe(2);
      expect(page.role.userCount).toBe(2);
      const byId = new Map(page.items.map((row) => [row.id, row]));
      expect(byId.get(String(inside))?.outOfScope).toBe(false);
      expect(byId.get(String(outside))?.outOfScope).toBe(true);
      expect(byId.get(String(inside))?.orgs).toEqual([
        { id: String(world.deptOne), name: "部門一" },
      ]);
    });

    it("分頁回 page / pageSize / totalCount", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "分頁測試角色",
        ownerOrgId: world.deptOne,
      });
      const members = [
        await createMember(world, [world.deptOne]),
        await createMember(world, [world.deptOne]),
        await createMember(world, [world.deptOne]),
      ];
      await grant(roleId, members);
      const page = await listUsers(roleId, { page: 2, pageSize: 2 });
      expect(page.totalCount).toBe(3);
      expect(page.page).toBe(2);
      expect(page.pageSize).toBe(2);
      expect(page.items).toHaveLength(1);
    });
  });

  describe("候選清單(roleUserCandidates)", () => {
    it("列管理範圍內的人:子樹內 eligible = true、子樹外 eligible = false(照列不隱藏)", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: nextAccount("候選:部門一的角色"),
        ownerOrgId: world.deptOne,
      });
      const inSubtree = await createMember(world, [world.teamOne], "cand-in");
      const outOfSubtree = await createMember(
        world,
        [world.deptTwo],
        "cand-out",
      );

      const { data, code } = await candidatesOf(roleId, { pageSize: 100 });
      expect(code).toBeUndefined();
      const byId = new Map(data?.items.map((row) => [row.id, row]));
      expect(byId.get(String(inSubtree))?.eligible).toBe(true);
      expect(byId.get(String(outOfSubtree))?.eligible).toBe(false);
      // 所屬組織名稱照樣附上(管理範圍內的才露,與 roleUsers 同一條)
      expect(byId.get(String(inSubtree))?.orgs).toEqual([
        { id: String(world.teamOne), name: "小組一" },
      ]);
    });

    it("已持有這個角色的人不在候選裡(排除已持有)", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: nextAccount("候選:排除已持有"),
        ownerOrgId: world.deptOne,
      });
      const member = await createMember(world, [world.deptOne], "cand-holder");
      const before = await candidatesOf(roleId, { pageSize: 100 });
      expect(before.data?.items.map((row) => row.id)).toContain(String(member));

      await grant(roleId, [member]);
      const after = await candidatesOf(roleId, { pageSize: 100 });
      expect(after.data?.items.map((row) => row.id)).not.toContain(
        String(member),
      );
    });

    it("操作者管理範圍外的人不在候選裡(即使資格上說得通)", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: nextAccount("候選:範圍外"),
        ownerOrgId: world.deptOne,
      });
      const outsider = await createMember(world, [world.deptOfB], "cand-b");
      const { data } = await candidatesOf(roleId, { pageSize: 100 });
      expect(data?.items.map((row) => row.id)).not.toContain(String(outsider));
    });

    it("keyword 比對姓名 / 帳號 / Email,並回 page / pageSize / totalCount", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: nextAccount("候選:關鍵字"),
        ownerOrgId: world.deptOne,
      });
      const account = nextAccount("needle-cand");
      const needle = await createUser(connection, {
        account,
        password: PASSWORD,
        orgIds: [world.deptOne],
      });

      const { data } = await candidatesOf(roleId, {
        keyword: account,
        page: 1,
        pageSize: 5,
      });
      expect(data?.page).toBe(1);
      expect(data?.pageSize).toBe(5);
      expect(data?.totalCount).toBe(1);
      expect(data?.items.map((row) => row.id)).toEqual([String(needle)]);
    });

    it("角色在管理範圍外 → NOT_FOUND(不透露存在與否)", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: nextAccount("候選:租戶乙的角色"),
        ownerOrgId: world.tenantB,
      });
      const { code } = await candidatesOf(roleId, {});
      expect(code).toBe("NOT_FOUND");
    });

    it("只需要 assign-users,不必 system.user-manager.view", async () => {
      const assigner = await createManager(world, {
        orgIds: [world.tenantA],
        ownerOrgId: world.tenantA,
        moduleKeys: ["system", "system.role-manager"],
        permissionKeys: [
          "system.role-manager.view",
          "system.role-manager.assign-users",
        ],
      });
      const roleId = await createRole(world.api.app, connection, {
        name: nextAccount("候選:權限測試"),
        ownerOrgId: world.deptOne,
      });
      const member = await createMember(world, [world.deptOne], "cand-perm");

      const { data, code } = await candidatesOf(
        roleId,
        { pageSize: 100 },
        assigner.token,
      );
      expect(code).toBeUndefined();
      expect(data?.items.map((row) => row.id)).toContain(String(member));
    });

    it("缺 assign-users 權限 → FORBIDDEN(只有 view 不夠)", async () => {
      const viewer = await createManager(world, {
        orgIds: [world.tenantA],
        ownerOrgId: world.tenantA,
        moduleKeys: ["system", "system.role-manager"],
        permissionKeys: ["system.role-manager.view"],
      });
      const roleId = await createRole(world.api.app, connection, {
        name: nextAccount("候選:守門"),
        ownerOrgId: world.deptOne,
      });
      const { code } = await candidatesOf(roleId, {}, viewer.token);
      expect(code).toBe("FORBIDDEN");
    });
  });

  describe("移除授予與擁有者保護(ADR-0009)", () => {
    it("一般授予可移除,並寫 role.revoke-user 稽核;不存在的授予重送不報錯", async () => {
      const roleId = await createRole(world.api.app, connection, {
        name: "可移除的角色",
        ownerOrgId: world.deptOne,
      });
      const member = await createMember(world, [world.deptOne]);
      await grant(roleId, [member]);

      const { code } = await revoke(roleId, [member]);
      expect(code).toBeUndefined();
      expect(await holderIdsOf(roleId)).toEqual([]);
      const audit = await latestAudit(world, "role.revoke-user", roleId);
      expect(audit?.after?.userIds).toEqual([String(member)]);

      const again = await revoke(roleId, [member]);
      expect(again.code).toBeUndefined();
    });

    it("租戶擁有者的租戶管理員授予不可解除 → OWNER_PROTECTED;清單標 ownerProtected", async () => {
      const tenant = await createOrg(connection, {
        name: nextAccount("受保護租戶"),
        settings: { visibility: "subtree" },
      });
      const ownerAccount = nextAccount("owner");
      const ownerId = await createUser(connection, {
        account: ownerAccount,
        password: PASSWORD,
        orgIds: [tenant],
      });
      const copyRoleId = await createRole(world.api.app, connection, {
        name: "租戶管理員",
        ownerOrgId: tenant,
        assignTo: [ownerId],
      });
      await connection
        .collection("roles")
        .updateOne(
          { _id: copyRoleId },
          { $set: { "settings.templateKey": "tenant-admin" } },
        );
      await connection
        .collection("orgs")
        .updateOne({ _id: tenant }, { $set: { ownerUserId: ownerId } });

      // 同租戶的另一位角色管理員(管理範圍 = 該租戶)
      const tenantManager = await createManager(world, {
        orgIds: [tenant],
        ownerOrgId: tenant,
      });

      const page = await listUsers(copyRoleId, {}, tenantManager.token);
      expect(page.items[0]?.ownerProtected).toBe(true);

      const { code } = await revoke(copyRoleId, [ownerId], tenantManager.token);
      expect(code).toBe("OWNER_PROTECTED");
      expect(await holderIdsOf(copyRoleId)).toEqual([String(ownerId)]);
    });

    it("根組織的操作者不受擁有者保護限制", async () => {
      const tenant = await createOrg(connection, {
        name: nextAccount("受保護租戶"),
      });
      const ownerAccount = nextAccount("owner");
      const ownerId = await createUser(connection, {
        account: ownerAccount,
        password: PASSWORD,
        orgIds: [tenant],
      });
      const copyRoleId = await createRole(world.api.app, connection, {
        name: "租戶管理員",
        ownerOrgId: tenant,
        assignTo: [ownerId],
      });
      await connection
        .collection("roles")
        .updateOne(
          { _id: copyRoleId },
          { $set: { "settings.templateKey": "tenant-admin" } },
        );
      await connection
        .collection("orgs")
        .updateOne({ _id: tenant }, { $set: { ownerUserId: ownerId } });

      const rootAccount = nextAccount("root-operator");
      const rootUserId = await createUser(connection, {
        account: rootAccount,
        password: PASSWORD,
        orgIds: [world.rootOrgId],
      });
      await createRole(world.api.app, connection, {
        name: `根組織操作者-${rootAccount}`,
        ownerOrgId: world.rootOrgId,
        moduleKeys: ["system", "system.role-manager"],
        permissionKeys: [
          "system.role-manager.view",
          "system.role-manager.assign-users",
        ],
        assignTo: [rootUserId],
      });
      const rootToken = await login(world, rootAccount);

      const { code } = await revoke(copyRoleId, [ownerId], rootToken);
      expect(code).toBeUndefined();
      expect(await holderIdsOf(copyRoleId)).toEqual([]);
    });

    it("指令數與人數無關(TX-06 / TX-07):加入、清單、移除 1 人與 20 人一樣多", async () => {
      const singleRoleId = await createRole(world.api.app, connection, {
        name: "批次一人的角色",
        ownerOrgId: world.deptOne,
      });
      const manyRoleId = await createRole(world.api.app, connection, {
        name: "批次多人的角色",
        ownerOrgId: world.deptOne,
      });
      // 每位都是某個組織的擁有者:擁有者保護的判斷要走完整條路,逐人查才看得出來
      const members: Types.ObjectId[] = [];
      for (let index = 0; index < 21; index += 1) {
        const member = await createMember(world, [world.deptOne], "batch");
        const owned = await createOrg(connection, {
          name: nextAccount("批次擁有的組織"),
          parentId: world.deptOne,
        });
        await connection
          .collection("orgs")
          .updateOne({ _id: owned }, { $set: { ownerUserId: member } });
        members.push(member);
      }
      const [first, ...rest] = members;
      if (!first) {
        throw new Error("沒有建出測試使用者");
      }

      const grantOne = await countDbCommands(() =>
        grant(singleRoleId, [first]),
      );
      const grantMany = await countDbCommands(() => grant(manyRoleId, rest));
      expect(grantOne.result.code).toBeUndefined();
      expect(grantMany.result.code).toBeUndefined();
      expectDbCommandsAtMost(grantMany, grantOne.total, "加入 20 人");

      const listOne = await countDbCommands(() => listUsers(singleRoleId));
      const listMany = await countDbCommands(() =>
        listUsers(manyRoleId, { pageSize: 50 }),
      );
      expect(listMany.result.items).toHaveLength(20);
      expect(listMany.result.items.some((row) => row.ownerProtected)).toBe(
        false,
      );
      expectDbCommandsAtMost(listMany, listOne.total, "清單 20 人");

      const revokeOne = await countDbCommands(() =>
        revoke(singleRoleId, [first]),
      );
      const revokeMany = await countDbCommands(() => revoke(manyRoleId, rest));
      expect(revokeOne.result.code).toBeUndefined();
      expect(revokeMany.result.code).toBeUndefined();
      expectDbCommandsAtMost(revokeMany, revokeOne.total, "移除 20 人");
      expect(await holderIdsOf(manyRoleId)).toEqual([]);
    });

    it("缺 assign-users 權限 → FORBIDDEN", async () => {
      const viewer = await createManager(world, {
        orgIds: [world.tenantA],
        ownerOrgId: world.tenantA,
        moduleKeys: ["system", "system.role-manager"],
        permissionKeys: ["system.role-manager.view"],
      });
      const roleId = await createRole(world.api.app, connection, {
        name: "守門用的角色",
        ownerOrgId: world.deptOne,
      });
      const member = await createMember(world, [world.deptOne]);
      const { code } = await grant(roleId, [member], viewer.token);
      expect(code).toBe("FORBIDDEN");
    });
  });

  it("交易(TX-01):稽核寫入失敗 → 加入與移除的授予整個回復", async () => {
    const roleId = await createRole(world.api.app, connection, {
      name: "回復用的角色",
      ownerOrgId: world.deptOne,
    });
    const kept = await createMember(world, [world.deptOne]);
    const added = await createMember(world, [world.deptOne]);
    await grant(roleId, [kept]);

    const audit = jest
      .spyOn(world.api.app.get(AuditService), "record")
      .mockRejectedValue(new Error("模擬稽核寫入失敗"));
    try {
      const granted = await grant(roleId, [added]);
      const revoked = await revoke(roleId, [kept]);

      expect(granted.code).toBeDefined();
      expect(revoked.code).toBeDefined();
      expect(audit).toHaveBeenCalledTimes(2);
    } finally {
      audit.mockRestore();
    }
    expect(await holderIdsOf(roleId)).toEqual([String(kept)]);
  });
});
