import { describe, expect, it } from "@jest/globals";
import { Types } from "mongoose";

import type { RolesRepository } from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import type { RelationService } from "../database/relation.service";
import { findTenantAdminCopy } from "./tenant-admin-copy";

const READER: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: "all",
  managedOrgIds: "all",
  memberOrgIds: [],
  roleIds: [],
  memberTenants: [],
};

interface FakeRole {
  _id: Types.ObjectId;
  name: string;
  settings: Record<string, unknown>;
}

/** 假的關聯與角色表:`owned` = 這個組織擁有的角色(依順序)。 */
function depsOf(owned: FakeRole[]) {
  const asked: { orgIds: Types.ObjectId[]; roleQueries: number } = {
    orgIds: [],
    roleQueries: 0,
  };
  const relations = {
    listRoleIdsOfOrg: (orgId: Types.ObjectId) => {
      asked.orgIds.push(orgId);
      return Promise.resolve(owned.map((role) => role._id));
    },
  } as unknown as RelationService;
  const roles = {
    findMany: (
      _reader: OperatorContext,
      filter: { _id: { $in: unknown[] } },
    ) => {
      asked.roleQueries += 1;
      const ids = new Set(filter._id.$in.map(String));
      return Promise.resolve(owned.filter((role) => ids.has(String(role._id))));
    },
  } as unknown as RolesRepository;
  return { deps: { relations, roles }, asked };
}

const role = (name: string, settings: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  name,
  settings,
});

describe("findTenantAdminCopy(租戶管理員副本)", () => {
  it("組織擁有的角色裡,以 settings.templateKey = tenant-admin 標記的那一份", async () => {
    const tenant = new Types.ObjectId();
    const copy = role("租戶管理員", { templateKey: "tenant-admin" });
    const { deps, asked } = depsOf([role("店長"), copy]);

    const found = await findTenantAdminCopy(deps, READER, tenant);

    expect(found?._id).toEqual(copy._id);
    expect(asked.orgIds).toEqual([tenant]);
  });

  it("有好幾份時取第一份", async () => {
    const first = role("副本一", { templateKey: "tenant-admin" });
    const { deps } = depsOf([
      first,
      role("副本二", { templateKey: "tenant-admin" }),
    ]);

    const found = await findTenantAdminCopy(deps, READER, new Types.ObjectId());
    expect(found?._id).toEqual(first._id);
  });

  it("沒有標記的副本 → null;別的 templateKey 不算", async () => {
    const { deps } = depsOf([
      role("店長"),
      role("別的模板副本", { templateKey: "other" }),
    ]);

    await expect(
      findTenantAdminCopy(deps, READER, new Types.ObjectId()),
    ).resolves.toBeNull();
  });

  it("組織沒有擁有任何角色 → null,不查角色表", async () => {
    const { deps, asked } = depsOf([]);

    await expect(
      findTenantAdminCopy(deps, READER, new Types.ObjectId()),
    ).resolves.toBeNull();
    expect(asked.roleQueries).toBe(0);
  });
});
