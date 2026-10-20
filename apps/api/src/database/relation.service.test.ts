import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Model, Types } from "mongoose";

import type { OperatorContext } from "./operator-context";
import { DuplicateRelationError, RelationService } from "./relation.service";
import {
  CoreRelationship,
  CoreRelationshipSchema,
} from "./schemas/core-relationship.schema";
import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "./test-support/mongo-connection";

/** 組一個操作者上下文(核心關聯不受租戶過濾,兩個範圍在此皆無作用)。 */
function operator(actorId = new Types.ObjectId()): OperatorContext {
  return {
    actorId,
    currentOrgId: null,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    memberOrgIds: [],
    roleIds: [],
    memberTenants: [],
  };
}

/** 以集合比較 id(關聯讀取不保證順序)。 */
function idSet(ids: Types.ObjectId[]): Set<string> {
  return new Set(ids.map(String));
}

describe("RelationService(ADR-0001 核心關聯的唯一出口;對真 MongoDB 驗證)", () => {
  let database: TestDatabase;
  let model: Model<CoreRelationship>;
  let relations: RelationService;

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-relation-service");
    model = database.connection.model<CoreRelationship>(
      CoreRelationship.name,
      CoreRelationshipSchema,
    );
    await model.syncIndexes();
    relations = new RelationService(model);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  describe("user_role 角色授予", () => {
    it("assignRoleToUser 後,使用者側與角色側都讀得到這筆授予", async () => {
      const userId = new Types.ObjectId();
      const roleA = new Types.ObjectId();
      const roleB = new Types.ObjectId();
      const otherUser = new Types.ObjectId();

      await relations.assignRoleToUser(operator(), userId, roleA);
      await relations.assignRoleToUser(operator(), userId, roleB);
      await relations.assignRoleToUser(operator(), otherUser, roleA);

      expect(idSet(await relations.listRoleIdsOfUser(userId))).toEqual(
        idSet([roleA, roleB]),
      );
      expect(idSet(await relations.listUserIdsOfRole(roleA))).toEqual(
        idSet([userId, otherUser]),
      );
      await expect(
        relations.listRoleIdsOfUser(new Types.ObjectId()),
      ).resolves.toEqual([]);
    });

    it("同一筆授予重複寫入被唯一索引拒絕(DuplicateRelationError),資料庫仍只有一筆", async () => {
      const userId = new Types.ObjectId();
      const roleId = new Types.ObjectId();
      await relations.assignRoleToUser(operator(), userId, roleId);

      await expect(
        relations.assignRoleToUser(operator(), userId, roleId),
      ).rejects.toBeInstanceOf(DuplicateRelationError);
      await expect(relations.listRoleIdsOfUser(userId)).resolves.toHaveLength(
        1,
      );
    });
  });

  describe("org_role 擁有組織", () => {
    it("setRoleOwnerOrg 後,角色側查得到擁有組織、組織側列得到角色;未設定者為 null", async () => {
      const orgId = new Types.ObjectId();
      const roleA = new Types.ObjectId();
      const roleB = new Types.ObjectId();

      await relations.setRoleOwnerOrg(operator(), orgId, roleA);
      await relations.setRoleOwnerOrg(operator(), orgId, roleB);

      await expect(relations.findOwnerOrgIdOfRole(roleA)).resolves.toEqual(
        orgId,
      );
      expect(idSet(await relations.listRoleIdsOfOrg(orgId))).toEqual(
        idSet([roleA, roleB]),
      );
      await expect(
        relations.findOwnerOrgIdOfRole(new Types.ObjectId()),
      ).resolves.toBeNull();
    });

    it("一個角色僅一個擁有組織:改綁另一個組織被 second 側唯一索引拒絕,原擁有組織不變", async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      const roleId = new Types.ObjectId();
      await relations.setRoleOwnerOrg(operator(), orgA, roleId);

      await expect(
        relations.setRoleOwnerOrg(operator(), orgB, roleId),
      ).rejects.toBeInstanceOf(DuplicateRelationError);
      await expect(relations.findOwnerOrgIdOfRole(roleId)).resolves.toEqual(
        orgA,
      );
      await expect(relations.listRoleIdsOfOrg(orgB)).resolves.toEqual([]);
    });
  });

  describe("org_user 所屬組織", () => {
    it("addUserToOrg 後,使用者可屬多個組織、組織側列得到成員", async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      const userId = new Types.ObjectId();
      const otherUser = new Types.ObjectId();

      await relations.addUserToOrg(operator(), orgA, userId);
      await relations.addUserToOrg(operator(), orgB, userId);
      await relations.addUserToOrg(operator(), orgA, otherUser);

      expect(idSet(await relations.listOrgIdsOfUser(userId))).toEqual(
        idSet([orgA, orgB]),
      );
      expect(idSet(await relations.listUserIdsOfOrg(orgA))).toEqual(
        idSet([userId, otherUser]),
      );
    });

    it("removeUserFromOrg 只移除該組織的所屬關係,其他組織不受影響,之後可再加入", async () => {
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      const userId = new Types.ObjectId();
      await relations.addUserToOrg(operator(), orgA, userId);
      await relations.addUserToOrg(operator(), orgB, userId);

      await relations.removeUserFromOrg(operator(), orgA, userId);
      await expect(relations.listOrgIdsOfUser(userId)).resolves.toEqual([orgB]);
      await expect(relations.listUserIdsOfOrg(orgA)).resolves.toEqual([]);

      // 關聯是「有/沒有」的事實,移除後重新加入不得被防重索引擋下
      await relations.addUserToOrg(operator(), orgA, userId);
      expect(idSet(await relations.listOrgIdsOfUser(userId))).toEqual(
        idSet([orgA, orgB]),
      );
    });

    it("ADR-0003:從組織移除不自動解除任何角色授予", async () => {
      const orgId = new Types.ObjectId();
      const userId = new Types.ObjectId();
      const roleId = new Types.ObjectId();
      await relations.addUserToOrg(operator(), orgId, userId);
      await relations.setRoleOwnerOrg(operator(), orgId, roleId);
      await relations.assignRoleToUser(operator(), userId, roleId);

      await relations.removeUserFromOrg(operator(), orgId, userId);
      await expect(relations.listRoleIdsOfUser(userId)).resolves.toEqual([
        roleId,
      ]);
    });
  });

  describe("user_role 解除授予", () => {
    it("revokeRoleFromUser 只解除那一筆授予;同角色對其他人的授予不受影響", async () => {
      const userId = new Types.ObjectId();
      const otherUser = new Types.ObjectId();
      const roleId = new Types.ObjectId();
      await relations.assignRoleToUser(operator(), userId, roleId);
      await relations.assignRoleToUser(operator(), otherUser, roleId);

      await relations.revokeRoleFromUser(operator(), userId, roleId);
      await expect(relations.listRoleIdsOfUser(userId)).resolves.toEqual([]);
      await expect(relations.listUserIdsOfRole(roleId)).resolves.toEqual([
        otherUser,
      ]);
    });
  });

  describe("role_module / role_permission 角色綁模組、綁權限(ADR-0011 以多角色取聯集)", () => {
    it("listModuleIdsOfRoles / listPermissionIdsOfRoles 回傳多個角色的聯集,重複只算一次", async () => {
      const roleA = new Types.ObjectId();
      const roleB = new Types.ObjectId();
      const moduleShared = new Types.ObjectId();
      const moduleOnlyA = new Types.ObjectId();
      const permissionShared = new Types.ObjectId();
      const permissionOnlyB = new Types.ObjectId();

      await relations.bindModuleToRole(operator(), roleA, moduleShared);
      await relations.bindModuleToRole(operator(), roleA, moduleOnlyA);
      await relations.bindModuleToRole(operator(), roleB, moduleShared);
      await relations.bindPermissionToRole(operator(), roleA, permissionShared);
      await relations.bindPermissionToRole(operator(), roleB, permissionShared);
      await relations.bindPermissionToRole(operator(), roleB, permissionOnlyB);

      const moduleIds = await relations.listModuleIdsOfRoles([roleA, roleB]);
      expect(moduleIds).toHaveLength(2);
      expect(idSet(moduleIds)).toEqual(idSet([moduleShared, moduleOnlyA]));

      const permissionIds = await relations.listPermissionIdsOfRoles([
        roleA,
        roleB,
      ]);
      expect(permissionIds).toHaveLength(2);
      expect(idSet(permissionIds)).toEqual(
        idSet([permissionShared, permissionOnlyB]),
      );

      await expect(relations.listModuleIdsOfRoles([])).resolves.toEqual([]);
    });

    it("unbindModuleFromRole / unbindPermissionFromRole 只解除該角色的那一筆綁定", async () => {
      const roleA = new Types.ObjectId();
      const roleB = new Types.ObjectId();
      const moduleId = new Types.ObjectId();
      const permissionId = new Types.ObjectId();
      await relations.bindModuleToRole(operator(), roleA, moduleId);
      await relations.bindModuleToRole(operator(), roleB, moduleId);
      await relations.bindPermissionToRole(operator(), roleA, permissionId);
      await relations.bindPermissionToRole(operator(), roleB, permissionId);

      await relations.unbindModuleFromRole(operator(), roleA, moduleId);
      await relations.unbindPermissionFromRole(operator(), roleA, permissionId);

      await expect(relations.listModuleIdsOfRoles([roleA])).resolves.toEqual(
        [],
      );
      await expect(
        relations.listPermissionIdsOfRoles([roleA]),
      ).resolves.toEqual([]);
      await expect(relations.listModuleIdsOfRoles([roleB])).resolves.toEqual([
        moduleId,
      ]);
      await expect(
        relations.listPermissionIdsOfRoles([roleB]),
      ).resolves.toEqual([permissionId]);
    });
  });

  describe("批次寫入原語(供 seed 與後續功能共用)", () => {
    it("linkMany 一次寫入多種 type;meta 可寫可讀,thirdId 保留欄位落庫為 null,createdBy 由操作者填", async () => {
      const actorId = new Types.ObjectId();
      const orgId = new Types.ObjectId();
      const userId = new Types.ObjectId();
      const roleId = new Types.ObjectId();
      const grantedAt = new Date("2026-09-17T00:00:00.000Z");

      await relations.linkMany(operator(actorId), [
        { type: "org_user", firstId: orgId, secondId: userId },
        {
          type: "user_role",
          firstId: userId,
          secondId: roleId,
          meta: { grantedBy: actorId, grantedAt },
        },
      ]);

      await expect(relations.listOrgIdsOfUser(userId)).resolves.toEqual([
        orgId,
      ]);
      const grant = await relations.findLink("user_role", userId, roleId);
      expect(grant?.meta).toEqual({ grantedBy: actorId, grantedAt });
      expect(grant?.thirdId).toBeNull();
      expect(grant?.createdBy).toEqual(actorId);
      expect(grant?.updatedBy).toEqual(actorId);
      expect(grant?.createdAt).toBeInstanceOf(Date);
      await expect(
        relations.findLink("user_role", roleId, userId),
      ).resolves.toBeNull();

      // 資料庫最終狀態:thirdId 確實以 null 落庫(不是缺欄位)
      const stored = await model
        .findOne({ type: "user_role", firstId: userId, secondId: roleId })
        .lean();
      expect(stored).toMatchObject({ thirdId: null, createdBy: actorId });
    });

    it("linkMany 含重複項時整批拒絕(DuplicateRelationError)", async () => {
      const roleId = new Types.ObjectId();
      const moduleId = new Types.ObjectId();
      await relations.bindModuleToRole(operator(), roleId, moduleId);

      await expect(
        relations.linkMany(operator(), [
          { type: "role_module", firstId: roleId, secondId: moduleId },
          {
            type: "role_module",
            firstId: roleId,
            secondId: new Types.ObjectId(),
          },
        ]),
      ).rejects.toBeInstanceOf(DuplicateRelationError);
    });

    it("unlinkMany 回傳實際移除筆數;不存在的關聯不計", async () => {
      const roleId = new Types.ObjectId();
      const moduleA = new Types.ObjectId();
      const moduleB = new Types.ObjectId();
      await relations.bindModuleToRole(operator(), roleId, moduleA);
      await relations.bindModuleToRole(operator(), roleId, moduleB);

      await expect(
        relations.unlinkMany(operator(), [
          { type: "role_module", firstId: roleId, secondId: moduleA },
          { type: "role_module", firstId: roleId, secondId: moduleB },
          {
            type: "role_module",
            firstId: roleId,
            secondId: new Types.ObjectId(),
          },
        ]),
      ).resolves.toBe(2);
      await expect(relations.listModuleIdsOfRoles([roleId])).resolves.toEqual(
        [],
      );
    });

    it("ensureLinks 冪等:已存在者略過不報錯,回傳新增 / 未變計數;重跑第二次為 0 新增", async () => {
      const roleId = new Types.ObjectId();
      const moduleA = new Types.ObjectId();
      const moduleB = new Types.ObjectId();
      const links = [
        { type: "role_module" as const, firstId: roleId, secondId: moduleA },
        { type: "role_module" as const, firstId: roleId, secondId: moduleB },
      ];
      await relations.bindModuleToRole(operator(), roleId, moduleA);

      await expect(relations.ensureLinks(operator(), links)).resolves.toEqual({
        created: 1,
        unchanged: 1,
      });
      await expect(relations.ensureLinks(operator(), links)).resolves.toEqual({
        created: 0,
        unchanged: 2,
      });
      expect(idSet(await relations.listModuleIdsOfRoles([roleId]))).toEqual(
        idSet([moduleA, moduleB]),
      );
    });

    it("ensureLinks 對 org_role 改綁另一組織仍拒絕(不是「未變」,是衝突)", async () => {
      const roleId = new Types.ObjectId();
      await relations.setRoleOwnerOrg(operator(), new Types.ObjectId(), roleId);

      await expect(
        relations.ensureLinks(operator(), [
          { type: "org_role", firstId: new Types.ObjectId(), secondId: roleId },
        ]),
      ).rejects.toBeInstanceOf(DuplicateRelationError);
    });
  });
});
