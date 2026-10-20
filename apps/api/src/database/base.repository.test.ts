import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type HydratedDocument, type Model, Types } from "mongoose";

import { BaseRepository } from "./base.repository";
import type { OperatorContext } from "./operator-context";
import { TenantScopeError } from "./plugins/tenant-scope.plugin";
import {
  CoreRelationship,
  CoreRelationshipSchema,
} from "./schemas/core-relationship.schema";
import {
  DEMO_ITEM_ONE_MODULE_KEY,
  DemoItemOne,
  DemoItemOneSchema,
} from "./schemas/demo-item-one.schema";
import {
  FieldCategory,
  FieldCategorySchema,
} from "./schemas/field-category.schema";
import { Field, FieldSchema } from "./schemas/field.schema";
import { Module, ModuleSchema } from "./schemas/module.schema";
import { Org, OrgSchema } from "./schemas/org.schema";
import {
  type TestDatabase,
  openTestDatabase,
} from "./test-support/mongo-connection";

/**
 * 組一個操作者上下文;未指定者給合理預設(操作者 id 隨機、當前組織 = 可見集合第一個)。
 * `managedOrgIds` 預設跟著可見範圍走 — 本檔驗的是業務類 collection(demo_items_one),
 * 吃的是可見範圍;治理類(orgs)吃管理範圍,由需要的測試自己指定。
 */
function operator(
  overrides: Partial<OperatorContext> & Pick<OperatorContext, "visibleOrgIds">,
): OperatorContext {
  const firstVisible =
    overrides.visibleOrgIds === "all" ? null : overrides.visibleOrgIds[0];
  return {
    actorId: new Types.ObjectId(),
    currentOrgId: firstVisible ?? null,
    managedOrgIds: overrides.visibleOrgIds,
    // 本檔不起 Nest,資料範圍規則沒有 provider(見 plugins/data-scope-provider.ts);
    // 兩欄仍必填,預設空集合
    memberOrgIds: [],
    roleIds: [],
    memberTenants: [],
    ...overrides,
  };
}

describe("BaseRepository(ADR-0005 租戶隔離 / ADR-0007 基礎欄位;對真 MongoDB 驗證)", () => {
  let database: TestDatabase;
  let demoItemModel: Model<DemoItemOne>;
  let demoItems: BaseRepository<DemoItemOne, HydratedDocument<DemoItemOne>>;

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-base-repository");
    demoItemModel = database.connection.model<DemoItemOne>(
      DemoItemOne.name,
      DemoItemOneSchema,
    );
    demoItems = new BaseRepository(demoItemModel);
  });

  afterAll(async () => {
    await database.close();
  });

  /** 測試用的根組織 id(`ancestors` 為空);其餘組織都登記成它底下的租戶頂層。 */
  const rootOrgId = new Types.ObjectId();

  /**
   * 示範表是模組資料(`moduleData`):建立時要從 `orgId` 的祖先推 `tenantId`,
   * 所以測試用到的組織要真的在 `orgs` 裡。登記成根組織底下的租戶頂層(tenantId = 自己)。
   */
  async function registerOrgs(...ids: Types.ObjectId[]): Promise<void> {
    await database.connection.collection("orgs").insertMany(
      ids.map((id) => ({
        _id: id,
        name: `組織 ${String(id)}`,
        parentId: rootOrgId,
        ancestors: [rootOrgId],
      })),
    );
  }

  describe("租戶隔離:查詢自動限縮在操作者可見組織集合內", () => {
    const orgA = new Types.ObjectId();
    const orgB = new Types.ObjectId();
    const orgC = new Types.ObjectId();
    const asA = operator({ visibleOrgIds: [orgA] });
    const asB = operator({ visibleOrgIds: [orgB] });

    beforeAll(async () => {
      await registerOrgs(orgA, orgB);
      await demoItems.create(asA, { name: "A 的資料" });
      await demoItems.create(asB, { name: "B 的資料" });
    });

    it("findMany:只看得到可見集合內的資料;集合外的資料查不到", async () => {
      const seenByA = await demoItems.findMany(asA);
      expect(seenByA.map((item) => item.name)).toEqual(["A 的資料"]);

      const seenByAB = await demoItems.findMany(
        operator({ visibleOrgIds: [orgA, orgB] }),
      );
      const namesSeenByAB = seenByAB.map((item) => item.name);
      expect(namesSeenByAB).toHaveLength(2);
      expect(namesSeenByAB).toEqual(
        expect.arrayContaining(["A 的資料", "B 的資料"]),
      );

      const seenByC = await demoItems.findMany(
        operator({ visibleOrgIds: [orgC] }),
      );
      expect(seenByC).toEqual([]);
    });

    it("findById / findOne / count:集合外的資料查不到(null / 0),連用 id 直指也一樣", async () => {
      const [itemOfB] = await demoItems.findMany(asB);
      expect(itemOfB).toBeDefined();
      if (!itemOfB) {
        return;
      }

      await expect(demoItems.findById(asA, itemOfB._id)).resolves.toBeNull();
      await expect(
        demoItems.findOne(asA, { name: "B 的資料" }),
      ).resolves.toBeNull();
      await expect(demoItems.count(asA)).resolves.toBe(1);

      // 同一筆對 B 自己是看得到的(確認不是資料不存在)
      await expect(demoItems.findById(asB, itemOfB._id)).resolves.toMatchObject(
        { name: "B 的資料" },
      );
    });

    it("呼叫端自己下的 orgId 條件只會收窄,不能放寬到可見集合外", async () => {
      const escaped = await demoItems.findMany(asA, { orgId: orgB });
      expect(escaped).toEqual([]);
    });
  });

  describe("基礎欄位(ADR-0007):建立 / 更新自動填 createdBy、updatedBy 與時間", () => {
    const org = new Types.ObjectId();
    const creator = new Types.ObjectId();
    const editor = new Types.ObjectId();

    beforeAll(async () => {
      await registerOrgs(org);
    });

    it("create 填 createdBy = updatedBy = 操作者,並帶 createdAt / updatedAt", async () => {
      const created = await demoItems.create(
        operator({ visibleOrgIds: [org], actorId: creator }),
        { name: "由 creator 建立" },
      );
      expect(created.createdBy).toEqual(creator);
      expect(created.updatedBy).toEqual(creator);
      expect(created.createdAt).toBeInstanceOf(Date);
      expect(created.updatedAt).toBeInstanceOf(Date);
      expect(created.deletedAt).toBeNull();
    });

    it("updateById 只改 updatedBy 為新操作者,createdBy 不動", async () => {
      const asCreator = operator({ visibleOrgIds: [org], actorId: creator });
      const asEditor = operator({ visibleOrgIds: [org], actorId: editor });
      const created = await demoItems.create(asCreator, { name: "待編輯" });

      const updated = await demoItems.updateById(asEditor, created._id, {
        name: "已編輯",
      });
      expect(updated).toMatchObject({
        name: "已編輯",
        createdBy: creator,
        updatedBy: editor,
      });

      // 更新同樣受租戶隔離:可見集合外的操作者改不到(回 null、資料不變)
      const outsider = operator({ visibleOrgIds: [new Types.ObjectId()] });
      await expect(
        demoItems.updateById(outsider, created._id, { name: "越權改名" }),
      ).resolves.toBeNull();
      await expect(
        demoItems.findById(asCreator, created._id),
      ).resolves.toMatchObject({ name: "已編輯" });
    });
  });

  describe("updateMany:批次更新同樣受租戶隔離與欄位保護", () => {
    const orgA = new Types.ObjectId();
    const orgB = new Types.ObjectId();

    beforeAll(async () => {
      await registerOrgs(orgA, orgB);
    });

    it("只更新可見範圍內符合條件的資料,回傳筆數;updatedBy 為操作者;不得觸及 orgId", async () => {
      const asA = operator({ visibleOrgIds: [orgA] });
      const asB = operator({ visibleOrgIds: [orgB] });
      await demoItems.create(asA, { name: "A-1" });
      await demoItems.create(asA, { name: "A-2" });
      await demoItems.create(asB, { name: "B-1" });

      const modified = await demoItems.updateMany(
        asA,
        {},
        { $set: { name: "批次改名" } },
      );
      expect(modified).toBe(2);

      const seenByA = await demoItems.findMany(asA);
      expect(seenByA.map((item) => item.name)).toEqual([
        "批次改名",
        "批次改名",
      ]);
      expect(seenByA.every((item) => item.updatedBy?.equals(asA.actorId))).toBe(
        true,
      );
      const seenByB = await demoItems.findMany(asB);
      expect(seenByB.map((item) => item.name)).toEqual(["B-1"]);

      await expect(
        demoItems.updateMany(asA, {}, { $set: { orgId: orgB } }),
      ).rejects.toBeInstanceOf(TenantScopeError);
    });
  });

  describe("軟刪除(ADR-0007):deletedAt 有值即視為不存在,資料仍保留", () => {
    const org = new Types.ObjectId();
    const asMember = operator({ visibleOrgIds: [org] });

    beforeAll(async () => {
      await registerOrgs(org);
    });

    it("softDeleteById 後預設查不到;includeDeleted 才看得到且 deletedAt 有值", async () => {
      const created = await demoItems.create(asMember, { name: "將被刪除" });

      const deleted = await demoItems.softDeleteById(asMember, created._id);
      expect(deleted?.deletedAt).toBeInstanceOf(Date);
      expect(deleted?.updatedBy).toEqual(asMember.actorId);

      await expect(
        demoItems.findById(asMember, created._id),
      ).resolves.toBeNull();
      expect(await demoItems.findMany(asMember)).toEqual([]);
      await expect(demoItems.count(asMember)).resolves.toBe(0);

      const stillStored = await demoItems.findMany(
        asMember,
        {},
        { includeDeleted: true },
      );
      expect(stillStored.map((item) => item.name)).toEqual(["將被刪除"]);

      // 已刪除的資料不可再被更新(視為不存在)
      await expect(
        demoItems.updateById(asMember, created._id, { name: "死而復生" }),
      ).resolves.toBeNull();
    });
  });

  describe("寫入保護與根組織(ADR-0005)", () => {
    const orgA = new Types.ObjectId();
    const orgB = new Types.ObjectId();

    beforeAll(async () => {
      await registerOrgs(orgA, orgB);
    });

    it("updateById 不得變更 orgId 與建立資訊(不可把資料搬進別的組織)", async () => {
      const asA = operator({ visibleOrgIds: [orgA] });
      const created = await demoItems.create(asA, { name: "留在 A" });

      await expect(
        demoItems.updateById(asA, created._id, { $set: { orgId: orgB } }),
      ).rejects.toBeInstanceOf(TenantScopeError);
      await expect(
        demoItems.updateById(asA, created._id, { orgId: orgB }),
      ).rejects.toBeInstanceOf(TenantScopeError);
      await expect(
        demoItems.updateById(asA, created._id, {
          $set: { createdBy: new Types.ObjectId() },
        }),
      ).rejects.toBeInstanceOf(TenantScopeError);

      // 資料仍在 A、內容未變
      const still = await demoItems.findById(asA, created._id);
      expect(still?.orgId).toEqual(orgA);
      expect(still?.name).toBe("留在 A");
    });

    it("create 不可寫入可見範圍外的組織;未指定 orgId 時寫入當前組織", async () => {
      const asA = operator({ visibleOrgIds: [orgA] });
      await expect(
        demoItems.create(asA, { name: "越權寫入", orgId: orgB }),
      ).rejects.toBeInstanceOf(TenantScopeError);

      const created = await demoItems.create(asA, { name: "寫入當前組織" });
      expect(created.orgId).toEqual(orgA);

      // 沒有當前組織(如尚未選組織)也不允許建立租戶資料
      await expect(
        demoItems.create(
          operator({ visibleOrgIds: [orgA], currentOrgId: null }),
          { name: "無當前組織" },
        ),
      ).rejects.toBeInstanceOf(TenantScopeError);
    });

    it('根組織 visibleOrgIds = "all":看得到全部,也可寫入任一組織', async () => {
      const asRoot = operator({ visibleOrgIds: "all" });
      await demoItems.create(operator({ visibleOrgIds: [orgB] }), {
        name: "B 的私有資料",
      });
      const created = await demoItems.create(asRoot, {
        name: "根組織代 A 建立",
        orgId: orgA,
      });
      expect(created.orgId).toEqual(orgA);

      const seenByRoot = await demoItems.findMany(asRoot, {
        orgId: { $in: [orgA, orgB] },
      });
      expect(seenByRoot.map((item) => item.name)).toEqual(
        expect.arrayContaining(["B 的私有資料", "根組織代 A 建立"]),
      );
    });
  });

  describe("模組資料(tenantScopePlugin 的 moduleData):moduleKey 寫死、tenantId 由後端推導", () => {
    const tenantTop = new Types.ObjectId();
    const dept = new Types.ObjectId();
    const team = new Types.ObjectId();
    const otherTenant = new Types.ObjectId();

    beforeAll(async () => {
      await database.connection.collection("orgs").insertMany([
        { _id: rootOrgId, name: "根", parentId: null, ancestors: [] },
        {
          _id: tenantTop,
          name: "租戶",
          parentId: rootOrgId,
          ancestors: [rootOrgId],
        },
        {
          _id: dept,
          name: "部門",
          parentId: tenantTop,
          ancestors: [rootOrgId, tenantTop],
        },
        {
          _id: team,
          name: "小組",
          parentId: dept,
          ancestors: [rootOrgId, tenantTop, dept],
        },
      ]);
    });

    it("三層以上的組織(根 → 租戶 → 部門 → 小組):tenantId 仍是租戶頂層", async () => {
      const created = await demoItems.create(
        operator({ visibleOrgIds: [team] }),
        { name: "小組的資料" },
      );
      expect(created.tenantId).toEqual(tenantTop);
    });

    it("建立時 moduleKey = 本表的模組 key;tenantId = orgId 的租戶頂層(部門 → 租戶頂層)", async () => {
      const created = await demoItems.create(
        operator({ visibleOrgIds: [dept] }),
        { name: "部門的資料" },
      );
      expect(created.moduleKey).toBe(DEMO_ITEM_ONE_MODULE_KEY);
      expect(created.tenantId).toEqual(tenantTop);
    });

    it("呼叫端給的 tenantId 一律忽略(後端推導為準)", async () => {
      const created = await demoItems.create(
        operator({ visibleOrgIds: [dept] }),
        { name: "偷填 tenantId", tenantId: otherTenant },
      );
      expect(created.tenantId).toEqual(tenantTop);
    });

    it("根組織的資料 tenantId = null(根組織不屬於任何租戶)", async () => {
      const created = await demoItems.create(
        operator({ visibleOrgIds: "all", currentOrgId: rootOrgId }),
        { name: "根組織的資料" },
      );
      expect(created.tenantId).toBeNull();
    });

    it("所屬組織不存在 → TenantScopeError(不寫出沒有租戶邊界的資料)", async () => {
      await expect(
        demoItems.create(operator({ visibleOrgIds: "all" }), {
          name: "孤兒",
          orgId: new Types.ObjectId(),
        }),
      ).rejects.toBeInstanceOf(TenantScopeError);
    });

    it("一般更新不得改 moduleKey / tenantId", async () => {
      const asDept = operator({ visibleOrgIds: [dept] });
      const created = await demoItems.create(asDept, { name: "鎖住兩欄" });
      await expect(
        demoItems.updateById(asDept, created._id, {
          $set: { moduleKey: "someone-else" },
        }),
      ).rejects.toBeInstanceOf(TenantScopeError);
      await expect(
        demoItems.updateMany(asDept, {}, { $set: { tenantId: otherTenant } }),
      ).rejects.toBeInstanceOf(TenantScopeError);
    });
  });

  describe("封裝邊界(ADR-0001):核心關聯只能經 RelationService", () => {
    it("以 core_relationships 的 Model 建 BaseRepository 直接拒絕(不給第二個入口)", () => {
      const coreRelationshipModel = database.connection.model<CoreRelationship>(
        CoreRelationship.name,
        CoreRelationshipSchema,
      );
      expect(() => new BaseRepository(coreRelationshipModel)).toThrow(
        /RelationService/,
      );
    });
  });

  describe("非租戶資料 vs 租戶資料的判定機制:是否掛 tenantScope plugin", () => {
    it("種子表(modules)未掛 tenantScope:任何操作者都查得到,且同樣自動填基礎欄位", async () => {
      const modules = new BaseRepository(
        database.connection.model<Module>(Module.name, ModuleSchema),
      );
      const asTenant = operator({ visibleOrgIds: [new Types.ObjectId()] });
      const created = await modules.create(asTenant, {
        key: "seed-only-module",
        name: "種子模組",
        sidebarType: "link",
      });
      expect(created.createdBy).toEqual(asTenant.actorId);

      const asOther = operator({ visibleOrgIds: [new Types.ObjectId()] });
      await expect(
        modules.findOne(asOther, { key: "seed-only-module" }),
      ).resolves.toMatchObject({ name: "種子模組" });
    });

    it("租戶表被裸查(未攜帶操作者上下文)→ 拋 TenantScopeError,不會靜默回傳全部", async () => {
      await expect(demoItemModel.find().exec()).rejects.toBeInstanceOf(
        TenantScopeError,
      );
      await expect(
        demoItemModel.countDocuments({}).exec(),
      ).rejects.toBeInstanceOf(TenantScopeError);
    });

    it("orgs 以自身 _id 判定可見:只看得到可見集合內的組織", async () => {
      const orgs = new BaseRepository(
        database.connection.model<Org>(Org.name, OrgSchema),
      );
      const asRoot = operator({ visibleOrgIds: "all" });
      const tenantA = await orgs.create(asRoot, { name: "租戶 A" });
      const tenantB = await orgs.create(asRoot, { name: "租戶 B" });

      const asA = operator({ visibleOrgIds: [tenantA._id] });
      const seenByA = await orgs.findMany(asA);
      expect(seenByA.map((org) => org.name)).toEqual(["租戶 A"]);
      await expect(orgs.findById(asA, tenantB._id)).resolves.toBeNull();
    });

    it("fields:orgId null 的全域種子對所有租戶可見(ADR-0005 $or),租戶自訂選項只有自己看得到;全域只有根組織可建", async () => {
      const fields = new BaseRepository(
        database.connection.model<Field>(Field.name, FieldSchema),
      );
      const categories = new BaseRepository(
        database.connection.model<FieldCategory>(
          FieldCategory.name,
          FieldCategorySchema,
        ),
      );
      const asRoot = operator({ visibleOrgIds: "all" });
      const category = await categories.create(asRoot, {
        key: "gender",
        name: "性別",
      });
      const orgA = new Types.ObjectId();
      const orgB = new Types.ObjectId();
      const asA = operator({ visibleOrgIds: [orgA] });
      const asB = operator({ visibleOrgIds: [orgB] });

      await fields.create(asRoot, {
        categoryId: category._id,
        orgId: null,
        label: "男",
        value: "male",
      });
      await fields.create(asA, {
        categoryId: category._id,
        label: "A 自訂",
        value: "custom-a",
      });

      const seenByA = await fields.findMany(asA, { categoryId: category._id });
      expect(seenByA.map((field) => field.value)).toEqual(
        expect.arrayContaining(["male", "custom-a"]),
      );
      expect(seenByA).toHaveLength(2);

      const seenByB = await fields.findMany(asB, { categoryId: category._id });
      expect(seenByB.map((field) => field.value)).toEqual(["male"]);

      // 租戶不可建立全域選項
      await expect(
        fields.create(asA, {
          categoryId: category._id,
          orgId: null,
          label: "偷建全域",
          value: "sneaky",
        }),
      ).rejects.toBeInstanceOf(TenantScopeError);
    });
  });
});
