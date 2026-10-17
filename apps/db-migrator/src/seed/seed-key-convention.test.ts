import { describe, expect, it } from "@jest/globals";

import { seedRegistry } from "../../seeds/registry";
import { seedRegistry as baseRegistry } from "../../test/fixtures/seeds-base/registry";
import {
  type SeedDocument,
  type SeedRegistry,
  seedRef,
} from "./seed-declaration";
import { findSeedKeyViolations } from "./seed-key-convention";

/** 以最小 registry 描述一棵模組樹與其權限(純資料,不碰資料庫)。 */
function registryOf(
  modules: SeedDocument[],
  permissions: SeedDocument[] = [],
): SeedRegistry {
  return [
    { kind: "documents", collection: "modules", entries: modules },
    { kind: "documents", collection: "permissions", entries: permissions },
  ];
}

/** 頁面節點(有 route,預設取 key 末段);`route: null` 代表非頁面的權限容器(api 樹、tenant-ops)。 */
function moduleNode(
  key: string,
  sidebarType: "group" | "link" | "hidden",
  parentKey: string | null = null,
  route: string | null = key.split(".").at(-1) ?? key,
): SeedDocument {
  return {
    key,
    data: {
      name: key,
      sidebarType,
      parentId: parentKey === null ? null : seedRef("modules", parentKey),
      ...(route === null ? {} : { route }),
    },
  };
}

function permission(key: string, moduleKey: string): SeedDocument {
  return {
    key,
    data: { name: key, moduleId: seedRef("modules", moduleKey) },
  };
}

const demoTree = [
  moduleNode("demo", "group"),
  moduleNode("demo.sub", "group", "demo"),
  moduleNode("demo.sub.sample-one", "link", "demo.sub"),
  moduleNode("demo.sub.sample-one.edit-page", "hidden", "demo.sub.sample-one"),
];

/** 每個模組各一筆 `<key>.*`(wildcard 只代表該模組自己這一層,含群組與隱藏頁)。 */
const demoWildcards = demoTree.map((node) =>
  permission(`${node.key}.*`, node.key),
);

describe("種子權限 key 規約(ADR-0004;純函式全掃種子宣告)", () => {
  it("合規的模組樹與權限沒有違規", () => {
    const violations = findSeedKeyViolations(
      registryOf(demoTree, [
        ...demoWildcards,
        permission("demo.sub.sample-one.view", "demo.sub.sample-one"),
        permission(
          "demo.sub.sample-one.show-internal-note",
          "demo.sub.sample-one",
        ),
        permission(
          "demo.sub.sample-one.edit-page.show-history",
          "demo.sub.sample-one.edit-page",
        ),
      ]),
    );
    expect(violations).toEqual([]);
  });

  it("key 必須全小寫 kebab-case、以「.」分層(模組與權限皆然)", () => {
    const violations = findSeedKeyViolations(
      registryOf(
        [...demoTree, moduleNode("demo.SampleTwo", "link", "demo")],
        [
          ...demoWildcards,
          permission("demo.SampleTwo.*", "demo.SampleTwo"),
          permission("demo.sub.sample-one.showField", "demo.sub.sample-one"),
          permission("demo.sub.sample-one.show_field", "demo.sub.sample-one"),
        ],
      ),
    );
    expect(violations).toEqual([
      expect.stringContaining("模組 demo.SampleTwo"),
      expect.stringContaining("權限 demo.SampleTwo.*"),
      expect.stringContaining("demo.sub.sample-one.showField"),
      expect.stringContaining("demo.sub.sample-one.show_field"),
    ]);
  });

  it("權限 key = 擁有模組 key + 「.」+ 動作,動作恆為單段", () => {
    const violations = findSeedKeyViolations(
      registryOf(demoTree, [
        ...demoWildcards,
        // 前綴不是 moduleId 指向的模組
        permission("demo.sub.view", "demo.sub.sample-one"),
        // 動作多段
        permission("demo.sub.sample-one.field.show", "demo.sub.sample-one"),
      ]),
    );
    expect(violations).toEqual([
      expect.stringContaining("demo.sub.view"),
      expect.stringContaining("demo.sub.sample-one.field.show"),
    ]);
  });

  it("隱藏頁(有 route)模組 key 一律以 -page 結尾,其他側欄型別不得以 -page 結尾", () => {
    const extra = [
      moduleNode("demo.sub.sample-one.view", "hidden", "demo.sub.sample-one"),
      moduleNode("demo.list-page", "link", "demo"),
    ];
    const violations = findSeedKeyViolations(
      registryOf(
        [...demoTree, ...extra],
        [
          ...demoWildcards,
          ...extra.map((node) => permission(`${node.key}.*`, node.key)),
        ],
      ),
    );
    expect(violations).toEqual([
      expect.stringContaining("demo.sub.sample-one.view"),
      expect.stringContaining("demo.list-page"),
    ]);
  });

  it("無 route 的隱藏節點不是頁面,豁免 -page 規則(api 樹,ADR-0004「API 權限」)", () => {
    const apiTree = [
      moduleNode("api", "hidden", null, null),
      moduleNode("api.export", "hidden", "api", null),
    ];
    const violations = findSeedKeyViolations(
      registryOf(
        apiTree,
        apiTree.map((node) => permission(`${node.key}.*`, node.key)),
      ),
    );
    expect(violations).toEqual([]);
  });

  it("無 route 的隱藏節點也可掛在頁面模組底下當純權限容器(system.org-manager.tenant-ops)", () => {
    const container = moduleNode(
      "demo.sub.sample-one.owner-ops",
      "hidden",
      "demo.sub.sample-one",
      null,
    );
    const violations = findSeedKeyViolations(
      registryOf(
        [...demoTree, container],
        [
          ...demoWildcards,
          permission(`${container.key}.*`, container.key),
          permission("demo.sub.sample-one.owner-ops.provision", container.key),
        ],
      ),
    );
    expect(violations).toEqual([]);
  });

  it("非頁面節點(無 route)不得以 -page 結尾(-page 專屬於隱藏頁)", () => {
    const fake = moduleNode(
      "demo.sub.sample-one.ghost-page",
      "hidden",
      "demo.sub.sample-one",
      null,
    );
    const violations = findSeedKeyViolations(
      registryOf(
        [...demoTree, fake],
        [...demoWildcards, permission(`${fake.key}.*`, fake.key)],
      ),
    );
    expect(violations).toEqual([
      expect.stringContaining("demo.sub.sample-one.ghost-page"),
    ]);
  });

  it("子模組 key 必須以父模組 key + 「.」為前綴(D1:key 累加父 key)", () => {
    const orphanNaming = moduleNode("org-manager", "link", "demo");
    const violations = findSeedKeyViolations(
      registryOf(
        [...demoTree, orphanNaming],
        [...demoWildcards, permission("org-manager.*", "org-manager")],
      ),
    );
    expect(violations).toEqual([expect.stringContaining("org-manager")]);
  });

  it("每個模組必有且只有一筆 wildcard `<key>.*`", () => {
    const violations = findSeedKeyViolations(
      registryOf(demoTree, [
        ...demoWildcards.filter((entry) => entry.key !== "demo.sub.*"),
        permission("demo.*", "demo"),
      ]),
    );
    expect(violations).toEqual([
      expect.stringContaining("權限 demo.*:key 重複宣告"),
      expect.stringContaining("模組 demo:必有且只有一筆"),
      expect.stringContaining("模組 demo.sub:必有且只有一筆"),
    ]);
  });

  it("權限動作禁用 -page 結尾(模組 key 與權限 key 永不同字串)", () => {
    const violations = findSeedKeyViolations(
      registryOf(demoTree, [
        ...demoWildcards,
        permission("demo.sub.sample-one.edit-page", "demo.sub.sample-one"),
      ]),
    );
    expect(violations).toEqual([
      expect.stringContaining("demo.sub.sample-one.edit-page"),
    ]);
  });

  it("key 全域唯一(模組之間、權限之間、模組與權限之間)", () => {
    const violations = findSeedKeyViolations(
      registryOf(
        [...demoTree, moduleNode("demo.sub", "group", "demo")],
        [
          ...demoWildcards,
          permission("demo.sub.sample-one.view", "demo.sub.sample-one"),
          permission("demo.sub.sample-one.view", "demo.sub.sample-one"),
        ],
      ),
    );
    expect(violations).toEqual([
      expect.stringContaining("demo.sub"),
      expect.stringContaining("demo.sub.sample-one.view"),
    ]);
  });

  it("權限的 moduleId 與模組的 parentId 必須指向已宣告(且先宣告)的模組", () => {
    const violations = findSeedKeyViolations(
      registryOf(
        [moduleNode("demo.sub", "group", "demo"), moduleNode("demo", "group")],
        [
          permission("demo.sub.*", "demo.sub"),
          permission("demo.*", "demo"),
          permission("nowhere.view", "nowhere"),
        ],
      ),
    );
    expect(violations).toEqual([
      expect.stringContaining("demo.sub"),
      expect.stringContaining("nowhere.view"),
    ]);
  });
});

function entryKeysOf(registry: SeedRegistry, collection: string): string[] {
  return registry.flatMap((set) =>
    set.kind === "documents" && set.collection === collection
      ? set.entries.map((entry) => entry.key)
      : [],
  );
}

describe("seeds/registry.ts 靜態檢查(正式 registry:底座 + 引用專案登記的內容)", () => {
  it("所有種子模組與權限宣告皆符合 key 規約", () => {
    expect(findSeedKeyViolations(seedRegistry)).toEqual([]);
  });

  it("專案登記不取代也不拿掉底座的模組與權限:底座宣告的每一個 key 都還在", () => {
    for (const collection of ["modules", "permissions"]) {
      expect(entryKeysOf(seedRegistry, collection)).toEqual(
        expect.arrayContaining(entryKeysOf(baseRegistry, collection)),
      );
    }
  });
});

describe("底座宣告的靜態檢查(空的專案來源夾具:數量不隨引用專案的登記變動)", () => {
  it("所有種子模組與權限宣告皆符合 key 規約", () => {
    expect(findSeedKeyViolations(baseRegistry)).toEqual([]);
  });

  it("示範家族(含三個示範表單)、治理模組(含表單 / 流程管理)、申請中心、通知設定、印表機管理與列印 API 依正本落地:個別權限 12 + 13 + 8 + 7 + 4 + 5 + 2 + 5 + 7 + 1 + 2 + 3 + 2 + 4 × 3 = 83 筆;全部 41 個模組各一筆 wildcard(共 124 筆)", () => {
    const moduleKeys = entryKeysOf(baseRegistry, "modules");
    const permissionKeys = entryKeysOf(baseRegistry, "permissions");

    // 正本:docs/modules/demo.sub.sample-one.md 家族模組樹 + demo.sample-two.md 模組節點
    // + docs/modules/demo-form.md(頂層 / 群組內 / 次群組內)
    expect(moduleKeys.filter((key) => key.startsWith("demo"))).toEqual([
      "demo",
      "demo.sub",
      "demo.sub.sample-one",
      "demo.sub.sample-one.view-page",
      "demo.sub.sample-one.create-page",
      "demo.sub.sample-one.edit-page",
      "demo.sample-two",
      "demo.sample-two.view-page",
      "demo.sample-two.create-page",
      "demo.sample-two.edit-page",
      "demo.form",
      "demo.form.view-page",
      "demo.form.create-page",
      "demo.form.edit-page",
      "demo.sub.form",
      "demo.sub.form.view-page",
      "demo.sub.form.create-page",
      "demo.sub.form.edit-page",
      "demo-form",
      "demo-form.view-page",
      "demo-form.create-page",
      "demo-form.edit-page",
    ]);

    // 正本:示範家族兩份權限表(7 + 5)+ docs/modules/org-manager.md(13)、user-manager.md(8)、
    // role-manager.md(7)、module-manager.md(4)、field-manager.md(4 + 類別作業 1)、data-scope.md(2)、forms.md(5)、
    // notification-settings.md(2)
    const individualKeys = permissionKeys.filter((key) => !key.endsWith(".*"));
    expect(individualKeys).toHaveLength(83);
    expect(new Set(individualKeys)).toEqual(
      new Set([
        "demo.sub.sample-one.view",
        "demo.sub.sample-one.create",
        "demo.sub.sample-one.edit",
        "demo.sub.sample-one.delete",
        "demo.sub.sample-one.show-internal-note",
        "demo.sub.sample-one.edit-internal-note",
        "demo.sub.sample-one.create-page.show-tips",
        "demo.sub.sample-one.edit-page.show-history",
        "demo.sample-two.view",
        "demo.sample-two.create",
        "demo.sample-two.edit",
        "demo.sample-two.delete",
        "system.org-manager.view",
        "system.org-manager.create-child",
        "system.org-manager.edit",
        "system.org-manager.toggle-enabled",
        "system.org-manager.move",
        "system.org-manager.delete",
        // 組織詳情的「成員」頁籤(#377;移除成員仍走使用者管理的「選擇所屬組織」)
        "system.org-manager.view-members",
        "system.org-manager.add-members",
        // 2026-09-19 從 tenant-ops 搬到組織管理層(#187 / ADR-0005:租戶自己的資料政策)
        "system.org-manager.set-visibility",
        "system.org-manager.set-timezone",
        "system.org-manager.tenant-ops.provision",
        "system.org-manager.tenant-ops.revoke-provision",
        "system.org-manager.tenant-ops.transfer-owner",
        "system.user-manager.view",
        "system.user-manager.create",
        "system.user-manager.edit",
        "system.user-manager.toggle-enabled",
        "system.user-manager.manage-orgs",
        "system.user-manager.assign-roles",
        "system.user-manager.show-national-id",
        "system.user-manager.edit-national-id",
        "system.role-manager.view",
        "system.role-manager.create",
        "system.role-manager.edit",
        "system.role-manager.edit-matrix",
        "system.role-manager.assign-users",
        "system.role-manager.toggle-enabled",
        "system.role-manager.delete",
        // 模組與權限、資料範圍是根組織專屬(模組層 isRootOnly,租戶模板整個模組被扣除)
        "system.module-manager.view",
        "system.module-manager.toggle-enabled",
        // #288:換側欄圖示是獨立權限(與停用 / 啟用的後果差太遠,不共用一把鑰匙)
        "system.module-manager.set-icon",
        // 表單發布產生、已退役的欄位級權限的清理(三層檢查)
        "system.module-manager.delete-retired-permission",
        "system.field-manager.view",
        "system.field-manager.create",
        "system.field-manager.edit",
        "system.field-manager.toggle-enabled",
        // 類別作業(根組織專屬的權限容器,照 tenant-ops 的形狀)
        "system.field-manager.category-ops.manage-categories",
        "system.data-scope.view",
        "system.data-scope.edit",
        // 表單管理(docs/modules/forms.md 權限表)
        "system.forms.view",
        "system.forms.create",
        "system.forms.edit",
        "system.forms.assign",
        "system.forms.set-enabled",
        // 三個示範表單模組:各四筆基本權限
        ...["demo-form", "demo.form", "demo.sub.form"].flatMap((key) => [
          `${key}.view`,
          `${key}.create`,
          `${key}.edit`,
          `${key}.delete`,
        ]),
        // 流程管理(Spec 6b §8):6 個 + 阻擋清單頁自有的改派
        "system.workflows.view",
        "system.workflows.create",
        "system.workflows.edit",
        "system.workflows.delete",
        "system.workflows.publish",
        "system.workflows.assign",
        "system.workflows.blocked-page.reassign",
        // 申請中心(固定模組)
        "apply-center.view",
        // 通知設定(docs/modules/notification-settings.md 權限表)
        "system.notification-settings.view",
        "system.notification-settings.edit",
        // 印表機管理與列印 API(docs/modules/printers.md)
        "system.printers.view",
        "system.printers.create",
        "system.printers.edit",
        "api.printing.print",
        "api.printing.reprint",
      ]),
    );

    // 每個模組各一筆 `<key>.*`(D3:wildcard 只代表該模組自己這一層)
    expect(moduleKeys).toHaveLength(41);
    expect(new Set(permissionKeys.filter((key) => key.endsWith(".*")))).toEqual(
      new Set(moduleKeys.map((key) => `${key}.*`)),
    );
    expect(permissionKeys).toHaveLength(124);

    // D1:治理模組 key 累加 system 群組前綴;tenant-ops / category-ops 是頁面模組底下的純權限容器
    expect(moduleKeys.filter((key) => key.startsWith("system"))).toEqual([
      "system",
      "system.org-manager",
      "system.org-manager.tenant-ops",
      "system.user-manager",
      "system.role-manager",
      "system.module-manager",
      "system.field-manager",
      "system.field-manager.category-ops",
      "system.data-scope",
      "system.forms",
      "system.workflows",
      "system.workflows.blocked-page",
      "system.notification-settings",
      "system.printers",
    ]);
  });
});
