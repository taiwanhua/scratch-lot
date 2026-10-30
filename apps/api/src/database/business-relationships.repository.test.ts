import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type Model, Types } from "mongoose";

import { BaseRepository } from "./base.repository";
import { BusinessRelationshipsRepository } from "./business-relationships.repository";
import type { OperatorContext } from "./operator-context";
import { TenantScopeError } from "./plugins/tenant-scope.plugin";
import {
  BusinessRelationship,
  BusinessRelationshipSchema,
} from "./schemas/business-relationship.schema";
import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "./test-support/mongo-connection";

/** id 字串的穩定排序(STRUCT-10:不留給執行環境的預設語言)。 */
const byText = (left: string, right: string): number =>
  left.localeCompare(right, "zh-Hant");

/** 站在某組織、只看得到那一個組織的操作者(部門使用者的典型:可見範圍不含租戶頂層)。 */
function standingAt(orgId: Types.ObjectId): OperatorContext {
  return {
    actorId: new Types.ObjectId(),
    currentOrgId: orgId,
    visibleOrgIds: [orgId],
    managedOrgIds: [],
    memberOrgIds: [orgId],
    roleIds: [],
    memberTenants: [],
  };
}

/**
 * `business_relationships`:不掛可見範圍插件,以 `tenantId` 為邊界(對真 MongoDB)。
 *
 * 組織樹:root ─┬─ 租戶甲 ── 部門甲
 *               └─ 租戶乙
 */
describe("BusinessRelationshipsRepository(tenantId 邊界,fail-closed)", () => {
  let database: TestDatabase;
  let model: Model<BusinessRelationship>;
  let relations: BusinessRelationshipsRepository;

  const rootOrg = new Types.ObjectId();
  const tenantA = new Types.ObjectId();
  const deptA = new Types.ObjectId();
  const tenantB = new Types.ObjectId();
  const formOfA = new Types.ObjectId();
  const formOfB = new Types.ObjectId();

  const asRoot = standingAt(rootOrg);
  const asDeptA = standingAt(deptA);

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-business-relationships");
    model = database.connection.model<BusinessRelationship>(
      BusinessRelationship.name,
      BusinessRelationshipSchema,
    );
    await model.syncIndexes();
    relations = new BusinessRelationshipsRepository(model);
    await database.connection.collection("orgs").insertMany([
      { _id: rootOrg, name: "根", parentId: null, ancestors: [] },
      { _id: tenantA, name: "甲", parentId: rootOrg, ancestors: [rootOrg] },
      {
        _id: deptA,
        name: "部門甲",
        parentId: tenantA,
        ancestors: [rootOrg, tenantA],
      },
      { _id: tenantB, name: "乙", parentId: rootOrg, ancestors: [rootOrg] },
    ]);
    // root 分派:各租戶一筆 org_form(firstId = tenantId)
    for (const [tenant, form] of [
      [tenantA, formOfA],
      [tenantB, formOfB],
    ] as const) {
      await relations.create(
        asRoot,
        await relations.tenantIdFor(asRoot, tenant),
        {
          type: "org_form",
          firstId: tenant,
          secondId: form,
          meta: { enabled: true },
        },
      );
    }
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  it("部門使用者(可見範圍不含租戶頂層)查得到本租戶的 org_form", async () => {
    const tenantId = await relations.tenantIdFor(asDeptA);
    expect(tenantId).toEqual(tenantA);
    const rows = await relations.findMany(tenantId, {
      type: "org_form",
      meta: { enabled: true },
    });
    expect(rows.map((row) => String(row.secondId))).toEqual([String(formOfA)]);
  });

  it("查不到別租戶的列:以自己的 tenantId 查只有自己的;要求別租戶的 tenantId 直接拋錯", async () => {
    const own = await relations.findMany(await relations.tenantIdFor(asDeptA), {
      type: "org_form",
      secondId: formOfB,
    });
    expect(own).toEqual([]);
    await expect(
      relations.tenantIdFor(asDeptA, tenantB),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("沒帶 tenantId 的讀寫一律拋 TenantScopeError(fail-closed)", async () => {
    await expect(
      relations.findMany(null, { type: "org_form" }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      relations.findOne(undefined, { type: "org_form" }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      relations.create(asRoot, null, {
        type: "org_form",
        firstId: tenantA,
        secondId: new Types.ObjectId(),
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      relations.setMeta(asRoot, undefined, { type: "org_form" }, {}),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      relations.deleteMany(null, { type: "org_form" }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("根組織操作者要明給目標租戶(自己不是租戶,沒有預設);給了就能讀寫該租戶", async () => {
    await expect(relations.tenantIdFor(asRoot)).rejects.toBeInstanceOf(
      TenantScopeError,
    );
    const tenantId = await relations.tenantIdFor(asRoot, tenantB);
    const updated = await relations.setMeta(
      asRoot,
      tenantId,
      { type: "org_form", secondId: formOfB },
      { enabled: false },
    );
    expect(updated?.meta).toEqual({ enabled: false });
    // 租戶甲的列不受影響
    const rowsOfA = await relations.findMany(tenantA, { type: "org_form" });
    expect(rowsOfA[0]?.meta).toEqual({ enabled: true });
  });

  it("根組織指定的租戶必須是存在的租戶頂層:部門或不存在的 id 一律拋錯(不寫出孤兒 org_form)", async () => {
    await expect(relations.tenantIdFor(asRoot, deptA)).rejects.toBeInstanceOf(
      TenantScopeError,
    );
    await expect(
      relations.tenantIdFor(asRoot, new Types.ObjectId()),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(relations.tenantIdFor(asRoot, rootOrg)).rejects.toBeInstanceOf(
      TenantScopeError,
    );
  });

  it("(tenantId, type, firstId, secondId) 唯一:同一筆分派兩次被唯一索引擋下", async () => {
    await expect(
      relations.create(asRoot, tenantA, {
        type: "org_form",
        firstId: tenantA,
        secondId: formOfA,
      }),
    ).rejects.toMatchObject({ code: 11_000 });
  });

  it("org_workflow(流程分派):同樣以 tenantId 為邊界,別租戶查不到", async () => {
    const workflow = new Types.ObjectId();
    await relations.create(
      asRoot,
      await relations.tenantIdFor(asRoot, tenantA),
      {
        type: "org_workflow",
        firstId: tenantA,
        secondId: workflow,
        meta: {},
      },
    );
    const ownRows = await relations.findMany(
      await relations.tenantIdFor(asDeptA),
      { type: "org_workflow" },
    );
    expect(ownRows.map((row) => String(row.secondId))).toEqual([
      String(workflow),
    ]);
    await expect(
      relations.findMany(tenantB, { type: "org_workflow" }),
    ).resolves.toEqual([]);
  });

  it("org_form_workflow(三方):同租戶多張表單綁同一流程可以;同一張表單綁第二個流程被唯一鍵擋;換流程 = 改 thirdId", async () => {
    const leaveForm = new Types.ObjectId();
    const overtimeForm = new Types.ObjectId();
    const leaveFlow = new Types.ObjectId();
    const otherFlow = new Types.ObjectId();
    const tenantId = await relations.tenantIdFor(asDeptA);
    for (const form of [leaveForm, overtimeForm]) {
      await relations.create(asDeptA, tenantId, {
        type: "org_form_workflow",
        firstId: tenantA,
        secondId: form,
        thirdId: leaveFlow,
        meta: {},
      });
    }
    // 反查「哪些表單綁了這個流程」
    const bound = await relations.findMany(tenantId, {
      type: "org_form_workflow",
      thirdId: leaveFlow,
    });
    expect(bound.map((row) => String(row.secondId)).toSorted(byText)).toEqual(
      [String(leaveForm), String(overtimeForm)].toSorted(byText),
    );
    await expect(
      relations.create(asDeptA, tenantId, {
        type: "org_form_workflow",
        firstId: tenantA,
        secondId: leaveForm,
        thirdId: otherFlow,
      }),
    ).rejects.toMatchObject({ code: 11_000 });
    const switched = await relations.setThirdId(
      asDeptA,
      tenantId,
      { type: "org_form_workflow", secondId: leaveForm },
      otherFlow,
    );
    expect(String(switched?.thirdId)).toBe(String(otherFlow));
    // 別的租戶綁同一張表單 id 不受唯一鍵影響(鍵含 tenantId),也看不到甲的綁定
    await relations.create(asRoot, tenantB, {
      type: "org_form_workflow",
      firstId: tenantB,
      secondId: leaveForm,
      thirdId: leaveFlow,
    });
    await expect(
      relations.findMany(tenantB, {
        type: "org_form_workflow",
        thirdId: otherFlow,
      }),
    ).resolves.toEqual([]);
    await expect(
      relations.setThirdId(
        asRoot,
        null,
        { type: "org_form_workflow" },
        otherFlow,
      ),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("不能拿去建 BaseRepository(只能經本 repository,避免繞過 tenantId 邊界)", () => {
    expect(() => new BaseRepository(model)).toThrow(
      /BusinessRelationshipsRepository/,
    );
  });
});
