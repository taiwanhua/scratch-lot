/**
 * data:已開通的租戶補上批售單(`purchasing.wholesale`)與批售客戶(`dealers.wholesale-customers`)的權限(規格 21.2、21.8)。
 *
 * 開通腳本對已有權限的角色不覆蓋,重跑補不到。這裡對每個租戶補:
 *
 * - 開通時建立的「總部管理」:批售單全部、批售客戶全部
 * - 開通時建立的「店長」:批售單全部、批售客戶只看(分頁與詳情,沒有新增 / 編輯)
 *
 * 不動租戶管理員副本(租戶的天花板):既有租戶的新模組由根組織逐一開放(ADR-0009)。
 *
 * 只補已有同一塊功能的角色:批售單看有沒有綁 `purchasing.transfer`、批售客戶看有沒有綁 `dealers.contacts`
 * (租戶沒開放、或已自己拿掉的不補)。角色以名稱完全相同找(同開通腳本),而且要屬於某個組織(排除種子模板)。
 *
 * migration 在 seed 之前跑,這些模組與 `*` 權限可能還不存在:先照宣告補上(固定欄位),接著的 seed 以 key 認得同一筆、
 * 補齊其餘欄位。全新的資料庫(還沒有上層模組)什麼都不做。
 *
 * 冪等:模組、權限、關聯都以 key 找、沒有才新增;重跑不會重複。只新增、不動既有授權,`down` 不做事。
 */

/** 要補的模組(父在前;欄位同 `seeds/project/purchasing.wholesale.ts`、`dealers.ts`;遷移檔不 import 套件)。 */
const MODULES = [
  [
    "purchasing.wholesale",
    "purchasing",
    "批售單",
    "link",
    4,
    "wholesale",
    "form",
  ],
  [
    "purchasing.wholesale.view-page",
    "purchasing.wholesale",
    "詳情",
    "hidden",
    1,
    "view-page",
    "fixed",
  ],
  [
    "purchasing.wholesale.create-page",
    "purchasing.wholesale",
    "新增",
    "hidden",
    2,
    "create-page",
    "fixed",
  ],
  [
    "purchasing.wholesale.edit-page",
    "purchasing.wholesale",
    "編輯",
    "hidden",
    3,
    "edit-page",
    "fixed",
  ],
  [
    "dealers.wholesale-customers",
    "dealers",
    "批售客戶",
    "hidden",
    5,
    null,
    "fixed",
  ],
  [
    "dealers.wholesale-customers.view-page",
    "dealers.wholesale-customers",
    "批售客戶詳情",
    "hidden",
    1,
    "wholesale-customer-view-page",
    "fixed",
  ],
  [
    "dealers.wholesale-customers.create-page",
    "dealers.wholesale-customers",
    "新增批售客戶",
    "hidden",
    2,
    "wholesale-customer-create-page",
    "fixed",
  ],
  [
    "dealers.wholesale-customers.edit-page",
    "dealers.wholesale-customers",
    "編輯批售客戶",
    "hidden",
    3,
    "wholesale-customer-edit-page",
    "fixed",
  ],
];

const WHOLESALE = MODULES.slice(0, 4).map(([key]) => key);
const CUSTOMERS = MODULES.slice(4).map(([key]) => key);
const wildcard = (key) => `${key}.*`;

/** 角色 → 一塊功能:看哪個模組決定要不要補、補哪些模組與 `*`。 */
const GRANTS = {
  總部管理: [
    { when: "purchasing.transfer", modules: WHOLESALE, wildcards: WHOLESALE },
    {
      when: "dealers.contacts",
      modules: CUSTOMERS,
      wildcards: ["dealers.wholesale-customers"],
    },
  ],
  店長: [
    { when: "purchasing.transfer", modules: WHOLESALE, wildcards: WHOLESALE },
    {
      when: "dealers.contacts",
      modules: [
        "dealers.wholesale-customers",
        "dealers.wholesale-customers.view-page",
      ],
      wildcards: [],
    },
  ],
};

/** 補上模組(父不存在 = 這個環境還沒種過,跳過)與它這一層的 `*` 權限;回 key → _id。 */
async function ensureModules(db) {
  const modules = db.collection("modules");
  const permissions = db.collection("permissions");
  const moduleIds = new Map();
  const permissionIds = new Map();
  const now = new Date();
  for (const [
    key,
    parentKey,
    name,
    sidebarType,
    order,
    route,
    engine,
  ] of MODULES) {
    const parent = await modules.findOne({ key: parentKey });
    if (parent === null) {
      continue;
    }
    await modules.updateOne(
      { key },
      {
        $setOnInsert: {
          key,
          name,
          parentId: parent._id,
          ancestors: [...(parent.ancestors ?? []), parent._id],
          sidebarType,
          order,
          route,
          engine,
          enabled: true,
          isSystem: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    const module = await modules.findOne({ key }, { projection: { _id: 1 } });
    moduleIds.set(key, module._id);
    await permissions.updateOne(
      { key: wildcard(key) },
      {
        $setOnInsert: {
          key: wildcard(key),
          moduleId: module._id,
          name: "全部",
          enabled: true,
          isSystem: true,
          source: "seed",
          retiredAt: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    const permission = await permissions.findOne(
      { key: wildcard(key) },
      { projection: { _id: 1 } },
    );
    permissionIds.set(key, permission._id);
  }
  return { moduleIds, permissionIds };
}

/** 要補的角色:屬於某個組織的「總部管理」「店長」(沒軟刪除;租戶管理員副本不算)。 */
async function rolesToGrant(db) {
  const found = await db
    .collection("roles")
    .find(
      {
        deletedAt: null,
        name: { $in: ["總部管理", "店長"] },
        "settings.templateKey": { $ne: "tenant-admin" },
      },
      { projection: { name: 1 } },
    )
    .toArray();
  const owned = new Set(
    (
      await db
        .collection("core_relationships")
        .find(
          {
            type: "org_role",
            secondId: { $in: found.map((role) => role._id) },
          },
          { projection: { secondId: 1 } },
        )
        .toArray()
    ).map((link) => String(link.secondId)),
  );
  return found.flatMap((role) =>
    owned.has(String(role._id))
      ? [{ _id: role._id, grants: GRANTS[role.name] }]
      : [],
  );
}

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const roles = await rolesToGrant(db);
  if (roles.length === 0) {
    return;
  }
  const { moduleIds, permissionIds } = await ensureModules(db);
  const relations = db.collection("core_relationships");
  const now = new Date();
  for (const { _id: roleId, grants } of roles) {
    for (const { when, modules, wildcards } of grants) {
      const sibling = await db.collection("modules").findOne({ key: when });
      const bound =
        sibling !== null &&
        (await relations.findOne({
          type: "role_module",
          firstId: roleId,
          secondId: sibling._id,
        })) !== null;
      if (!bound) {
        continue;
      }
      const links = [
        ...modules.map((key) => ["role_module", moduleIds.get(key)]),
        ...wildcards.map((key) => ["role_permission", permissionIds.get(key)]),
      ];
      for (const [type, secondId] of links) {
        if (secondId === undefined) {
          continue;
        }
        await relations.updateOne(
          { type, firstId: roleId, secondId, thirdId: null },
          { $setOnInsert: { createdAt: now, updatedAt: now } },
          { upsert: true },
        );
      }
    }
  }
};

export const down = async () => {};
