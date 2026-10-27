import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { type HydratedDocument, type Model, Schema, Types } from "mongoose";

import { BaseRepository } from "./base.repository";
import { OrgsRepository } from "./base/repositories";
import type { MemberTenant, OperatorContext } from "./operator-context";
import { baseFieldsPlugin } from "./plugins/base-fields.plugin";
import { setDataScopeRuleProvider } from "./plugins/data-scope-provider";
import {
  type ShareOrg,
  TenantScopeError,
  type TenantScopeOptions,
  tenantScopePlugin,
} from "./plugins/tenant-scope.plugin";
import { Org, OrgSchema } from "./schemas/org.schema";
import { systemTenantReader } from "./system-tenant-reader";
import { tenantBoundaryContext } from "./tenant-boundary-context";
import {
  HOOK_TIMEOUT_MS,
  type TestDatabase,
  openTestDatabase,
} from "./test-support/mongo-connection";

/**
 * 資料共用(ADR-0014)對真 MongoDB 的表格測試:三種宣告 × 七種人 × 五種資料歸屬,
 * 每一格驗列表 / 單筆 / count / aggregate 一致;另驗寫入不放大、`shareOrgs` 的租戶檢查、
 * `sharedByFields`、資料範圍規則的先後與兩個租戶邊界出口。
 * lookup 的搜尋 / 依值取回 / 送出重驗走同一個 `findMany` / `count`(`forms/lookup-providers.ts`),
 * 端到端另見 `test-support/project-fixture/project-fixture-sharing.test.ts`。
 */

interface Item {
  orgId: Types.ObjectId;
  name: string;
  branchId?: Types.ObjectId | null;
  targetOrgIds?: Types.ObjectId[];
  moduleKey: string;
  tenantId: Types.ObjectId | null;
  shareOrgs?: ShareOrg[];
}

function itemSchema(collection: string, options: TenantScopeOptions): Schema {
  const schema = new Schema<Item>(
    {
      orgId: { type: Schema.Types.ObjectId, required: true },
      name: { type: String, required: true },
      branchId: { type: Schema.Types.ObjectId, default: null },
      targetOrgIds: { type: [Schema.Types.ObjectId], default: [] },
    },
    { collection, timestamps: true },
  );
  schema.index({ tenantId: 1, branchId: 1 });
  schema.index({ tenantId: 1, targetOrgIds: 1 });
  schema.plugin(baseFieldsPlugin);
  schema.plugin(tenantScopePlugin, { moduleData: true, ...options });
  schema.path("moduleKey").default("sharing-test");
  return schema;
}

type Repo = BaseRepository<Item, HydratedDocument<Item>>;

/** 依字串排序(比對用)。 */
const byText = (left: string, right: string): number =>
  left.localeCompare(right);

const sorted = (names: string[]): string[] => names.toSorted(byText);

/** 測試資料庫上的組織 repository(systemTenantReader 用)。 */
function orgsRepositoryOf(database: TestDatabase): OrgsRepository {
  return new OrgsRepository(
    database.connection.models[Org.name] ??
      database.connection.model(Org.name, OrgSchema),
  );
}

// ---- 組織樹:根 → 租戶甲(T)→ 分店一(B1)→ 分店一的下層(B1a);T → 分店二(B2);根 → 租戶乙(U)→ U1 ----
const root = new Types.ObjectId();
const T = new Types.ObjectId();
const B1 = new Types.ObjectId();
const B1a = new Types.ObjectId();
const B2 = new Types.ObjectId();
const U = new Types.ObjectId();
const U1 = new Types.ObjectId();

const ORGS: { _id: Types.ObjectId; ancestors: Types.ObjectId[] }[] = [
  { _id: root, ancestors: [] },
  { _id: T, ancestors: [root] },
  { _id: B1, ancestors: [root, T] },
  { _id: B1a, ancestors: [root, T, B1] },
  { _id: B2, ancestors: [root, T] },
  { _id: U, ancestors: [root] },
  { _id: U1, ancestors: [root, U] },
];

function ancestorsOf(orgId: Types.ObjectId): Types.ObjectId[] {
  return ORGS.find((org) => org._id.equals(orgId))?.ancestors ?? [];
}

/** 依登入線同一條規則組上下文(所屬組織、可見範圍、上層鏈、所屬租戶);`visible` 不給 = 只看所屬組織。 */
function person(
  members: Types.ObjectId[],
  visible?: Types.ObjectId[] | "all",
): OperatorContext {
  const tenants = new Map<string, MemberTenant>();
  for (const member of members) {
    const chain = ancestorsOf(member);
    const tenantId = chain.length === 0 ? null : (chain[1] ?? member);
    if (tenantId === null) {
      continue;
    }
    const group = tenants.get(String(tenantId)) ?? {
      tenantId,
      memberOrgIds: [],
      ancestorOrgIds: [],
    };
    group.memberOrgIds.push(member);
    for (const ancestor of chain.slice(1)) {
      if (!group.ancestorOrgIds.some((id) => id.equals(ancestor))) {
        group.ancestorOrgIds.push(ancestor);
      }
    }
    tenants.set(String(tenantId), group);
  }
  const visibleOrgIds = visible ?? members;
  return {
    actorId: new Types.ObjectId(),
    currentOrgId: members[0] ?? null,
    visibleOrgIds,
    managedOrgIds: [],
    memberOrgIds: members,
    roleIds: [],
    memberTenants: [...tenants.values()],
  };
}

/** 規格的七種人(ADR-0014 驗收表)加「別租戶」與「兩個租戶的人」;租戶管理員以「租戶開了含下層」示範可見範圍展開。 */
const PEOPLE = {
  總部屬頂層: person([T]),
  總部同時屬分店: person([T, B1]),
  單一分店人員: person([B1]),
  跨兩分店人員: person([B1, B2]),
  分店下層人員: person([B1a]),
  租戶管理員: person([T], [T, B1, B1a, B2]),
  根組織: person([root], "all"),
  別租戶: person([U1]),
  // 同時屬於兩個租戶:共用分支依租戶配對,不能拿乙租戶的組織去命中甲租戶的資料
  兩個租戶的人: person([B2, U1]),
} as const;
type PersonName = keyof typeof PEOPLE;

const PLACEMENTS = {
  頂層: T,
  分店: B1,
  分店下層: B1a,
  兄弟分店: B2,
  別租戶: U1,
} as const;

describe("資料共用(ADR-0014):三種宣告 × 人 × 資料歸屬", () => {
  let database: TestDatabase;
  let privateItems: Repo;
  let shareableItems: Repo;
  let inheritItems: Repo;
  let fixedItems: Repo;
  const asRoot = PEOPLE.根組織;

  async function seed(
    repository: Repo,
    name: string,
    orgId: Types.ObjectId,
    extra: Partial<Item> = {},
  ): Promise<Types.ObjectId> {
    const created = await repository.create(
      { ...asRoot, currentOrgId: orgId },
      { name, orgId, ...extra },
    );
    return created._id;
  }

  beforeAll(async () => {
    database = await openTestDatabase("cookhome-test-data-sharing");
    await database.connection.collection("orgs").insertMany(
      ORGS.map((org) => ({
        ...org,
        name: String(org._id),
        parentId: org.ancestors.at(-1) ?? null,
        deletedAt: null,
      })),
    );
    const model = (name: string, schema: Schema): Model<Item> =>
      database.connection.model<Item>(name, schema);
    privateItems = new BaseRepository(
      model("PrivateItem", itemSchema("sharing_private_items", {})),
    );
    shareableItems = new BaseRepository(
      model(
        "ShareableItem",
        itemSchema("sharing_shareable_items", {
          sharing: {
            mode: "shareable",
            defaultShareOrgs: "none",
            editable: true,
            sharedByFields: [
              { path: "branchId", includeDescendants: false },
              { path: "targetOrgIds", includeDescendants: true },
            ],
          },
          refFields: ["name"],
        }),
      ),
    );
    inheritItems = new BaseRepository(
      model(
        "InheritItem",
        itemSchema("sharing_inherit_items", {
          sharing: { mode: "inheritDown" },
        }),
      ),
    );
    fixedItems = new BaseRepository(
      model(
        "FixedItem",
        itemSchema("sharing_fixed_items", {
          sharing: {
            mode: "shareable",
            defaultShareOrgs: "wholeTenant",
            editable: false,
          },
        }),
      ),
    );
    for (const [placement, orgId] of Object.entries(PLACEMENTS)) {
      await seed(privateItems, placement, orgId);
      await seed(inheritItems, placement, orgId);
    }
    await seed(shareableItems, "頂層·不共用", T);
    await seed(shareableItems, "頂層·全部分店", T, {
      shareOrgs: [{ orgId: T, includeDescendants: true }],
    });
    await seed(shareableItems, "兄弟分店·給分店不含下層", B2, {
      shareOrgs: [{ orgId: B1, includeDescendants: false }],
    });
    await seed(shareableItems, "兄弟分店·給分店含下層", B2, {
      shareOrgs: [{ orgId: B1, includeDescendants: true }],
    });
    await seed(shareableItems, "分店下層·不共用", B1a);
    await seed(shareableItems, "別租戶·全部分店", U1, {
      shareOrgs: [{ orgId: U, includeDescendants: true }],
    });
    await seed(shareableItems, "兄弟分店·欄位指分店", B2, { branchId: B1 });
    await seed(shareableItems, "兄弟分店·陣列欄位指分店含下層", B2, {
      targetOrgIds: [B1],
    });
    // 繞過寫入檢查直接寫進去的兩筆(模擬資料損毀):租戶甲的資料卻共用 / 指到別租戶的組織 ——
    // plugin 每個共用分支都釘 tenantId,別租戶的人仍然看不到
    const now = new Date();
    await database.connection.collection("sharing_shareable_items").insertMany(
      [
        {
          name: "偽造·共用給別租戶",
          shareOrgs: [{ orgId: U1, includeDescendants: true }],
        },
        { name: "偽造·欄位指別租戶", branchId: U1, shareOrgs: [] },
      ].map((doc) => ({
        targetOrgIds: [],
        branchId: null,
        ...doc,
        orgId: T,
        tenantId: T,
        moduleKey: "sharing-test",
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
      })),
    );
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    setDataScopeRuleProvider(undefined);
    await database.close();
  }, HOOK_TIMEOUT_MS);

  /** 列表、單筆、count、aggregate 四種讀法各算一次,斷言一致後回列表看到的名稱(排序)。 */
  async function seenBy(
    repository: Repo,
    who: OperatorContext,
  ): Promise<string[]> {
    const listed = await repository.findMany(who);
    const names = listed.map((item) => item.name).toSorted(byText);
    await expect(repository.count(who)).resolves.toBe(listed.length);
    const aggregated = await repository.aggregate(who, [
      { $project: { name: 1 } },
    ]);
    expect(aggregated.map((row) => String(row.name)).toSorted(byText)).toEqual(
      names,
    );
    const all = await repository.findMany(asRoot);
    for (const item of all) {
      const single = await repository.findById(who, item._id);
      expect(single !== null).toBe(names.includes(item.name));
    }
    return names;
  }

  const TENANT_T_PRIVATE = ["分店", "分店下層", "兄弟分店", "頂層"];
  const EXPECTED_PRIVATE: Record<PersonName, string[]> = {
    總部屬頂層: ["頂層"],
    總部同時屬分店: ["分店", "頂層"],
    單一分店人員: ["分店"],
    跨兩分店人員: ["分店", "兄弟分店"],
    分店下層人員: ["分店下層"],
    租戶管理員: TENANT_T_PRIVATE,
    根組織: [...TENANT_T_PRIVATE, "別租戶"],
    別租戶: ["別租戶"],
    兩個租戶的人: ["兄弟分店", "別租戶"],
  };

  // 上層沿用到下層:可見範圍 ∪ 所屬組織的上層鏈(不隨當前組織切換)
  const EXPECTED_INHERIT: Record<PersonName, string[]> = {
    總部屬頂層: ["頂層"],
    總部同時屬分店: ["分店", "頂層"],
    單一分店人員: ["分店", "頂層"],
    跨兩分店人員: ["分店", "兄弟分店", "頂層"],
    分店下層人員: ["分店", "分店下層", "頂層"],
    租戶管理員: TENANT_T_PRIVATE,
    根組織: [...TENANT_T_PRIVATE, "別租戶"],
    別租戶: ["別租戶"],
    兩個租戶的人: ["兄弟分店", "別租戶", "頂層"],
  };

  const FORGED = ["偽造·共用給別租戶", "偽造·欄位指別租戶"];
  const TENANT_T_SHARED = [
    "兄弟分店·給分店不含下層",
    "兄弟分店·給分店含下層",
    "兄弟分店·欄位指分店",
    "兄弟分店·陣列欄位指分店含下層",
    "分店下層·不共用",
    "頂層·不共用",
    "頂層·全部分店",
    ...FORGED,
  ];
  const EXPECTED_SHAREABLE: Record<PersonName, string[]> = {
    總部屬頂層: sorted(["頂層·不共用", "頂層·全部分店", ...FORGED]),
    總部同時屬分店: sorted([
      "頂層·不共用",
      "頂層·全部分店",
      ...FORGED,
      "兄弟分店·給分店不含下層",
      "兄弟分店·給分店含下層",
      "兄弟分店·欄位指分店",
      "兄弟分店·陣列欄位指分店含下層",
    ]),
    單一分店人員: sorted([
      "頂層·全部分店",
      "兄弟分店·給分店不含下層",
      "兄弟分店·給分店含下層",
      "兄弟分店·欄位指分店",
      "兄弟分店·陣列欄位指分店含下層",
    ]),
    跨兩分店人員: sorted([
      "頂層·全部分店",
      "兄弟分店·給分店不含下層",
      "兄弟分店·給分店含下層",
      "兄弟分店·欄位指分店",
      "兄弟分店·陣列欄位指分店含下層",
    ]),
    // 分店下層的人:只拿得到「含下層」的共用
    分店下層人員: sorted([
      "分店下層·不共用",
      "頂層·全部分店",
      "兄弟分店·給分店含下層",
      "兄弟分店·陣列欄位指分店含下層",
    ]),
    租戶管理員: sorted(TENANT_T_SHARED),
    根組織: sorted([...TENANT_T_SHARED, "別租戶·全部分店"]),
    別租戶: ["別租戶·全部分店"],
    // 甲的偽造資料(共用 / 欄位指到乙的 U1)不會因為他同時屬於乙而出現
    兩個租戶的人: sorted([
      "頂層·全部分店",
      "兄弟分店·給分店不含下層",
      "兄弟分店·給分店含下層",
      "兄弟分店·欄位指分店",
      "兄弟分店·陣列欄位指分店含下層",
      "別租戶·全部分店",
    ]),
  };

  describe.each(Object.keys(PEOPLE) as PersonName[])("%s", (name) => {
    const who = PEOPLE[name];

    it("不可共用:照可見範圍", async () => {
      await expect(seenBy(privateItems, who)).resolves.toEqual(
        sorted(EXPECTED_PRIVATE[name]),
      );
    });

    it("上層沿用到下層:另看得到所屬組織上層鏈建的", async () => {
      await expect(seenBy(inheritItems, who)).resolves.toEqual(
        sorted(EXPECTED_INHERIT[name]),
      );
    });

    it("可共用:可見範圍 ∪ 共用給所屬組織(含下層看上層鏈)∪ 欄位指到所屬組織", async () => {
      await expect(seenBy(shareableItems, who)).resolves.toEqual(
        EXPECTED_SHAREABLE[name],
      );
    });
  });

  it("判斷共用看全部所屬組織,不看當前組織:切換當前組織,看到的不變", async () => {
    const atHq = { ...PEOPLE.總部同時屬分店, currentOrgId: T };
    const atBranch = { ...PEOPLE.總部同時屬分店, currentOrgId: B1 };
    await expect(seenBy(shareableItems, atHq)).resolves.toEqual(
      await seenBy(shareableItems, atBranch),
    );
    await expect(seenBy(inheritItems, atHq)).resolves.toEqual(
      await seenBy(inheritItems, atBranch),
    );
  });

  describe("修改 / 刪除不放大:共用進來的只能看", () => {
    async function sharedIn(): Promise<Types.ObjectId> {
      const item = await shareableItems.findOne(PEOPLE.單一分店人員, {
        name: "兄弟分店·給分店不含下層",
      });
      expect(item).not.toBeNull();
      return item?._id ?? new Types.ObjectId();
    }
    const who = PEOPLE.單一分店人員;

    it("updateById → null", async () => {
      await expect(
        shareableItems.updateById(who, await sharedIn(), {
          $set: { name: "改" },
        }),
      ).resolves.toBeNull();
    });

    it("findOneAndUpdate → null", async () => {
      await expect(
        shareableItems.findOneAndUpdate(
          who,
          { _id: await sharedIn() },
          { $set: { name: "改" } },
        ),
      ).resolves.toBeNull();
    });

    it("updateMany → 0 筆", async () => {
      await expect(
        shareableItems.updateMany(
          who,
          { _id: await sharedIn() },
          { $set: { name: "改" } },
        ),
      ).resolves.toBe(0);
    });

    it("softDeleteById → null", async () => {
      await expect(
        shareableItems.softDeleteById(who, await sharedIn()),
      ).resolves.toBeNull();
    });

    it("hardDeleteById → false", async () => {
      await expect(
        shareableItems.hardDeleteById(who, await sharedIn()),
      ).resolves.toBe(false);
    });

    it("findOwnAndUpdate(就算是自己建的)→ 共用進來就改不了", async () => {
      const mine = await shareableItems.create(
        { ...PEOPLE.跨兩分店人員, currentOrgId: B2 },
        {
          name: "跨兩分店人員在分店二建的",
          shareOrgs: [{ orgId: B1, includeDescendants: false }],
        },
      );
      // 同一個人只剩分店一的身分:那一筆變成共用進來的
      const onlyB1 = {
        ...PEOPLE.單一分店人員,
        actorId: PEOPLE.跨兩分店人員.actorId,
      };
      await expect(
        shareableItems.findById(onlyB1, mine._id),
      ).resolves.not.toBeNull();
      await expect(
        shareableItems.findOwnAndUpdate(
          onlyB1,
          { _id: mine._id },
          { $set: { name: "改" } },
        ),
      ).resolves.toBeNull();
    });

    it("建立照舊只能寫進可見範圍內的組織(共用不放寬 create)", async () => {
      await expect(
        shareableItems.create(
          { ...who, currentOrgId: B2 },
          { name: "寫到兄弟分店" },
        ),
      ).rejects.toThrow(TenantScopeError);
    });
  });

  describe("共用清單的租戶檢查", () => {
    it("建立時指到別租戶的組織 → VALIDATION_FAILED", async () => {
      await expect(
        shareableItems.create(PEOPLE.單一分店人員, {
          name: "共用給別租戶",
          shareOrgs: [{ orgId: U1, includeDescendants: false }],
        }),
      ).rejects.toMatchObject({
        extensions: { code: "VALIDATION_FAILED", fields: ["shareOrgs"] },
      });
    });

    it("更新時指到別租戶 / 不存在的組織 → VALIDATION_FAILED,資料不變", async () => {
      const own = await shareableItems.create(PEOPLE.單一分店人員, {
        name: "店長的",
      });
      for (const orgId of [U1, new Types.ObjectId()]) {
        await expect(
          shareableItems.updateById(PEOPLE.單一分店人員, own._id, {
            $set: { shareOrgs: [{ orgId, includeDescendants: false }] },
          }),
        ).rejects.toMatchObject({ extensions: { code: "VALIDATION_FAILED" } });
      }
      const after = await shareableItems.findById(PEOPLE.單一分店人員, own._id);
      expect(after?.shareOrgs).toEqual([]);
    });

    it("可以共用給自己看不到的同租戶組織;共用不讓分享者看更多", async () => {
      const own = await shareableItems.create(PEOPLE.單一分店人員, {
        name: "給分店二",
      });
      const updated = await shareableItems.updateById(
        PEOPLE.單一分店人員,
        own._id,
        {
          $set: { shareOrgs: [{ orgId: B2, includeDescendants: false }] },
        },
      );
      expect(
        (updated?.shareOrgs ?? []).map((entry) => String(entry.orgId)),
      ).toEqual([String(B2)]);
      const asB2 = person([B2]);
      await expect(
        shareableItems.findById(asB2, own._id),
      ).resolves.not.toBeNull();
    });

    it("shareOrgs 只能整份替換($push / 子路徑 → TenantScopeError)", async () => {
      const own = await shareableItems.create(PEOPLE.單一分店人員, {
        name: "push",
      });
      await expect(
        shareableItems.updateById(PEOPLE.單一分店人員, own._id, {
          $push: { shareOrgs: { orgId: B2, includeDescendants: false } },
        }),
      ).rejects.toThrow(TenantScopeError);
      await expect(
        shareableItems.updateById(PEOPLE.單一分店人員, own._id, {
          $set: { "shareOrgs.0.orgId": B2 },
        }),
      ).rejects.toThrow(TenantScopeError);
    });

    it("固定清單(editable: false):新增一律用預設(全部分店),呼叫端給的忽略、更新改不了", async () => {
      const created = await fixedItems.create(PEOPLE.單一分店人員, {
        name: "主檔",
        shareOrgs: [{ orgId: B1, includeDescendants: false }],
      });
      expect(
        (created.shareOrgs ?? []).map((entry) => [
          String(entry.orgId),
          entry.includeDescendants,
        ]),
      ).toEqual([[String(T), true]]);
      await expect(
        fixedItems.findById(PEOPLE.分店下層人員, created._id),
      ).resolves.not.toBeNull();
      await expect(
        fixedItems.findById(PEOPLE.別租戶, created._id),
      ).resolves.toBeNull();
      await expect(
        fixedItems.updateById(PEOPLE.單一分店人員, created._id, {
          $set: { shareOrgs: [] },
        }),
      ).rejects.toThrow(TenantScopeError);
    });
  });

  it("sharedByFields:欄位改了,看得到的人跟著變(不需同步任何清單)", async () => {
    const created = await shareableItems.create(
      { ...PEOPLE.跨兩分店人員, currentOrgId: B2 },
      { name: "訂單", branchId: B1 },
    );
    await expect(
      shareableItems.findById(PEOPLE.單一分店人員, created._id),
    ).resolves.not.toBeNull();
    // 不含下層:分店一的下層看不到
    await expect(
      shareableItems.findById(PEOPLE.分店下層人員, created._id),
    ).resolves.toBeNull();
    await shareableItems.updateById(
      { ...PEOPLE.跨兩分店人員, currentOrgId: B2 },
      created._id,
      { $set: { branchId: null, targetOrgIds: [B1] } },
    );
    // 換到含下層的陣列欄位:分店一與它的下層都看得到
    await expect(
      shareableItems.findById(PEOPLE.單一分店人員, created._id),
    ).resolves.not.toBeNull();
    await expect(
      shareableItems.findById(PEOPLE.分店下層人員, created._id),
    ).resolves.not.toBeNull();
    await shareableItems.updateById(
      { ...PEOPLE.跨兩分店人員, currentOrgId: B2 },
      created._id,
      { $set: { targetOrgIds: [] } },
    );
    await expect(
      shareableItems.findById(PEOPLE.單一分店人員, created._id),
    ).resolves.toBeNull();
  });

  it("sharedByFields match: visible:比對該租戶的可見範圍;上下文缺 visibleOrgIds 時退回所屬組織", async () => {
    const visibleItems = new BaseRepository(
      database.connection.model<Item>(
        "VisibleItem",
        itemSchema("sharing_visible_items", {
          sharing: {
            mode: "shareable",
            defaultShareOrgs: "none",
            editable: false,
            sharedByFields: [
              { path: "branchId", includeDescendants: false, match: "visible" },
            ],
          },
        }),
      ),
    );
    // 總部建、欄位指到分店一的下層
    const created = await visibleItems.create(
      { ...asRoot, currentOrgId: T },
      { name: "指到下層", orgId: T, branchId: B1a },
    );
    const branchOne = PEOPLE.單一分店人員;
    const withoutVisible: OperatorContext = {
      ...branchOne,
      visibleOrgIds: [B1, B1a],
      memberTenants: branchOne.memberTenants.map((tenant) => ({
        tenantId: tenant.tenantId,
        memberOrgIds: tenant.memberOrgIds,
        ancestorOrgIds: tenant.ancestorOrgIds,
      })),
    };
    const withVisible: OperatorContext = {
      ...withoutVisible,
      memberTenants: withoutVisible.memberTenants.map((tenant) => ({
        ...tenant,
        visibleOrgIds: [B1, B1a],
      })),
    };
    // 缺 visibleOrgIds:只比所屬組織(分店一)→ 看不到指到下層的
    await expect(
      visibleItems.findById(withoutVisible, created._id),
    ).resolves.toBeNull();
    // 該租戶的可見範圍含下層 → 看得到;寫入不放大
    await expect(
      visibleItems.findById(withVisible, created._id),
    ).resolves.not.toBeNull();
    await expect(
      visibleItems.updateById(withVisible, created._id, {
        $set: { name: "分店改的" },
      }),
    ).resolves.toBeNull();
    // 別的租戶的可見範圍不算(分支釘 tenantId)
    await expect(
      visibleItems.findById(
        {
          ...PEOPLE.別租戶,
          memberTenants: PEOPLE.別租戶.memberTenants.map((tenant) => ({
            ...tenant,
            visibleOrgIds: [U1, B1a],
          })),
        },
        created._id,
      ),
    ).resolves.toBeNull();
  });

  it("資料範圍規則仍會縮小共用資料(先放寬、再縮小)", async () => {
    setDataScopeRuleProvider({
      conditionFor: (collection) =>
        Promise.resolve(
          collection === "sharing_shareable_items"
            ? { name: { $ne: "頂層·全部分店" } }
            : null,
        ),
    });
    try {
      const names = await seenBy(shareableItems, PEOPLE.單一分店人員);
      expect(names).not.toContain("頂層·全部分店");
      expect(names).toContain("兄弟分店·給分店不含下層");
    } finally {
      setDataScopeRuleProvider(undefined);
    }
  });

  describe("租戶邊界出口", () => {
    it("existsInTenant:沒帶 tenantId 就拋錯", async () => {
      for (const tenantId of [null, undefined]) {
        await expect(
          shareableItems.existsInTenant(PEOPLE.單一分店人員, tenantId, {
            name: "x",
          }),
        ).rejects.toThrow(TenantScopeError);
      }
    });

    it("existsInTenant:整個租戶都問得到(不看可見範圍),別租戶問不到", async () => {
      await expect(
        shareableItems.existsInTenant(PEOPLE.單一分店人員, T, {
          name: "分店下層·不共用",
        }),
      ).resolves.toBe(true);
      await expect(
        shareableItems.existsInTenant(PEOPLE.單一分店人員, T, {
          name: "別租戶·全部分店",
        }),
      ).resolves.toBe(false);
      // 條件只能是「一個欄位等於一個值」:運算子物件、tenantId 欄位都拒收,放寬不了租戶邊界
      await expect(
        shareableItems.existsInTenant(PEOPLE.單一分店人員, T, {
          name: {
            $ne: null,
          },
        }),
      ).rejects.toThrow(TenantScopeError);
      await expect(
        shareableItems.existsInTenant(PEOPLE.單一分店人員, T, { tenantId: U }),
      ).rejects.toThrow(TenantScopeError);
      await expect(
        shareableItems.existsInTenant(PEOPLE.單一分店人員, T, { $where: "1" }),
      ).rejects.toThrow(TenantScopeError);
    });

    it("租戶邊界出口只能用在操作者所屬的租戶(根組織除外)", async () => {
      await expect(
        shareableItems.existsInTenant(PEOPLE.單一分店人員, U, {
          name: "別租戶·全部分店",
        }),
      ).rejects.toThrow(TenantScopeError);
      await expect(
        shareableItems.findRefsInTenant(PEOPLE.單一分店人員, U, [
          String(new Types.ObjectId()),
        ]),
      ).rejects.toThrow(TenantScopeError);
      await expect(
        shareableItems.existsInTenant(asRoot, U, { name: "別租戶·全部分店" }),
      ).resolves.toBe(true);
    });

    it("existsInTenant:略過資料範圍規則", async () => {
      setDataScopeRuleProvider({
        conditionFor: () => Promise.resolve({ _id: { $in: [] } }),
      });
      try {
        await expect(shareableItems.count(PEOPLE.租戶管理員)).resolves.toBe(0);
        await expect(
          shareableItems.existsInTenant(PEOPLE.單一分店人員, T, {
            name: "頂層·不共用",
          }),
        ).resolves.toBe(true);
      } finally {
        setDataScopeRuleProvider(undefined);
      }
    });

    it("findRefsInTenant:明列 id、只回 refFields;別租戶的 id 不回", async () => {
      const hidden = await shareableItems.findOne(asRoot, {
        name: "分店下層·不共用",
      });
      const other = await shareableItems.findOne(asRoot, {
        name: "別租戶·全部分店",
      });
      const refs = await shareableItems.findRefsInTenant(
        PEOPLE.單一分店人員,
        T,
        [String(hidden?._id), String(other?._id), "not-an-id"],
      );
      expect(refs).toEqual([{ _id: hidden?._id, name: "分店下層·不共用" }]);
      await expect(
        privateItems.findRefsInTenant(PEOPLE.單一分店人員, T, [
          String(hidden?._id),
        ]),
      ).rejects.toThrow(TenantScopeError);
    });

    it("aggregate 的 $facet / 巢狀管線夾帶 $lookup / $unionWith 也拒收", async () => {
      await expect(
        shareableItems.aggregate(PEOPLE.單一分店人員, [
          {
            $facet: {
              ok: [{ $project: { name: 1 } }],
              leak: [{ $unionWith: { coll: "sharing_private_items" } }],
            },
          },
        ]),
      ).rejects.toThrow(TenantScopeError);
      await expect(
        shareableItems.aggregate(PEOPLE.單一分店人員, [
          {
            $facet: {
              deeper: [
                {
                  $facet: {
                    leak: [
                      {
                        $lookup: {
                          from: "orgs",
                          pipeline: [],
                          as: "o",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ]),
      ).rejects.toThrow(TenantScopeError);
    });

    it("讀到的文件(含共用進來的)不能 save():更新一律經 BaseRepository", async () => {
      const shared = await shareableItems.findOne(PEOPLE.單一分店人員, {
        name: "兄弟分店·給分店不含下層",
      });
      expect(shared).not.toBeNull();
      if (!shared) {
        return;
      }
      shared.name = "經 save 改名";
      await expect(shared.save()).rejects.toThrow(TenantScopeError);
      const after = await shareableItems.findById(asRoot, shared._id);
      expect(after?.name).toBe("兄弟分店·給分店不含下層");
    });

    it("aggregate 不收會讀別張表的階段", async () => {
      await expect(
        shareableItems.aggregate(PEOPLE.單一分店人員, [
          {
            $lookup: {
              from: "orgs",
              localField: "orgId",
              foreignField: "_id",
              as: "o",
            },
          },
        ]),
      ).rejects.toThrow(TenantScopeError);
    });
  });

  describe("systemTenantReader(排程用的租戶系統身分)", () => {
    it("可見範圍 = 該租戶整棵組織樹;讀不到別租戶的資料", async () => {
      const reader = await systemTenantReader(orgsRepositoryOf(database), T);
      expect(
        (reader.visibleOrgIds as Types.ObjectId[]).map(String).toSorted(byText),
      ).toEqual([T, B1, B1a, B2].map(String).toSorted(byText));
      expect(reader.memberTenants.map((tenant) => tenant.tenantId)).toEqual([
        T,
      ]);
      const names = await seenBy(privateItems, reader);
      expect(names).toEqual(sorted(TENANT_T_PRIVATE));
    });

    it("沒帶 tenantId 或不是租戶頂層 → TenantScopeError", async () => {
      await expect(
        systemTenantReader(orgsRepositoryOf(database), null),
      ).rejects.toThrow(TenantScopeError);
      await expect(
        systemTenantReader(orgsRepositoryOf(database), B1),
      ).rejects.toThrow(TenantScopeError);
    });
  });

  describe("tenantBoundaryContext(反查 / 以人為準 / 例外寫入 / 排程的租戶邊界上下文)", () => {
    it("有操作者:租戶要是他所屬的、保留 actorId;別租戶 → TenantScopeError", async () => {
      const orgs = orgsRepositoryOf(database);
      const who = PEOPLE.單一分店人員;
      const context = await tenantBoundaryContext(orgs, who, T);
      expect(context.actorId).toEqual(who.actorId);
      expect(sorted(await seenBy(privateItems, context))).toEqual(
        sorted(TENANT_T_PRIVATE),
      );
      await expect(tenantBoundaryContext(orgs, who, U)).rejects.toThrow(
        TenantScopeError,
      );
    });

    it("沒有操作者 = 租戶系統身分;沒有租戶(null)只有根組織成員可用", async () => {
      const orgs = orgsRepositoryOf(database);
      const system = await tenantBoundaryContext(orgs, null, U);
      expect(system.actorId).toBeNull();
      expect(await seenBy(privateItems, system)).toEqual(["別租戶"]);
      await expect(tenantBoundaryContext(orgs, asRoot, null)).resolves.toBe(
        asRoot,
      );
      await expect(
        tenantBoundaryContext(orgs, PEOPLE.單一分店人員, null),
      ).rejects.toThrow(TenantScopeError);
      await expect(tenantBoundaryContext(orgs, null, null)).rejects.toThrow(
        TenantScopeError,
      );
    });
  });

  describe("tenantId 一律由 orgId 推導(自己宣告 tenantId 欄的表也一樣)", () => {
    interface Link {
      orgId: Types.ObjectId;
      tenantId: Types.ObjectId | null;
      name: string;
    }
    let links: BaseRepository<Link, HydratedDocument<Link>>;

    beforeAll(() => {
      const schema = new Schema<Link>(
        {
          orgId: { type: Schema.Types.ObjectId, required: true },
          tenantId: { type: Schema.Types.ObjectId, default: null },
          name: { type: String, required: true },
        },
        { collection: "sharing_links", timestamps: true },
      );
      schema.plugin(baseFieldsPlugin);
      schema.plugin(tenantScopePlugin, { refFields: ["name"] });
      links = new BaseRepository(
        database.connection.model<Link>("SharingLink", schema),
      );
    });

    it("呼叫端給錯的 tenantId 會被覆蓋;租戶邊界出口不會跨租戶命中;更新改不了 tenantId", async () => {
      const created = await links.create(
        { ...asRoot, currentOrgId: B1 },
        { orgId: B1, tenantId: U, name: "給錯租戶的關聯" },
      );
      expect(created.tenantId).toEqual(T);
      await expect(
        links.existsInTenant(PEOPLE.別租戶, U, { name: "給錯租戶的關聯" }),
      ).resolves.toBe(false);
      await expect(
        links.existsInTenant(PEOPLE.單一分店人員, T, {
          name: "給錯租戶的關聯",
        }),
      ).resolves.toBe(true);
      await expect(
        links.findRefsInTenant(PEOPLE.別租戶, U, [created._id]),
      ).resolves.toEqual([]);
      await expect(
        links.updateById(asRoot, created._id, { $set: { tenantId: U } }),
      ).rejects.toThrow(TenantScopeError);
    });
  });

  describe("宣告自洽(掛 plugin 時就擋)", () => {
    it("sharedByFields 的欄位沒有 { tenantId, 欄位 } 索引 → TenantScopeError", () => {
      const schema = new Schema(
        { orgId: Schema.Types.ObjectId, branchId: Schema.Types.ObjectId },
        { collection: "x" },
      );
      expect(() =>
        schema.plugin(tenantScopePlugin, {
          moduleData: true,
          sharing: {
            mode: "shareable",
            defaultShareOrgs: "none",
            editable: true,
            sharedByFields: [{ path: "branchId", includeDescendants: false }],
          },
        }),
      ).toThrow(TenantScopeError);
    });

    it("sharedByFields 比對可見範圍(match: visible)又勾 includeDescendants → TenantScopeError", () => {
      const schema = new Schema(
        { orgId: Schema.Types.ObjectId, branchId: Schema.Types.ObjectId },
        { collection: "visible_with_descendants" },
      );
      schema.index({ tenantId: 1, branchId: 1 });
      expect(() =>
        schema.plugin(tenantScopePlugin, {
          moduleData: true,
          sharing: {
            mode: "shareable",
            defaultShareOrgs: "none",
            editable: false,
            sharedByFields: [
              { path: "branchId", includeDescendants: true, match: "visible" },
            ],
          },
        }),
      ).toThrow(TenantScopeError);
    });

    it("可共用但不是模組資料表 → TenantScopeError", () => {
      const schema = new Schema(
        { orgId: Schema.Types.ObjectId },
        { collection: "y" },
      );
      expect(() =>
        schema.plugin(tenantScopePlugin, {
          sharing: {
            mode: "shareable",
            defaultShareOrgs: "none",
            editable: true,
          },
        }),
      ).toThrow(TenantScopeError);
    });

    it("治理類的表不能宣告共用 → TenantScopeError", () => {
      const schema = new Schema({ name: String }, { collection: "z" });
      expect(() =>
        schema.plugin(tenantScopePlugin, {
          path: "_id",
          kind: "governance",
          sharing: { mode: "inheritDown" },
        }),
      ).toThrow(TenantScopeError);
    });
  });
});
