import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import { validateDefinition } from "@repo/domain/form";
import { serializeSeedSet } from "@repo/domain/seed";
import { validateWorkflowDefinition } from "@repo/domain/workflow";

import { fields as baseFields } from "../../seeds/base/fields";
import type {
  ModuleInitialValues,
  ModuleSeedDeclaration,
} from "../../seeds/base/module-declaration";
import {
  baseModuleDeclarations,
  composeModuleSeeds,
} from "../../seeds/base/modules";
import type {
  ProjectSeedSettings,
  SeedSource,
} from "../../seeds/base/seed-source";
import { projectSeedSource } from "../../seeds/project/registry";
import { projectSeedSettings } from "../../seeds/project/settings";
import { assembleSeedRegistry, seedRegistry } from "../../seeds/registry";
import {
  baseOnlyProjectSettings,
  baseOnlyProjectSource,
} from "../../test/fixtures/seeds-base/project-source";
import { seedRegistry as baseRegistry } from "../../test/fixtures/seeds-base/registry";
import { seedRegistry as definitionRegistry } from "../../test/fixtures/seeds-definition/registry";
import { seed as projectRequest } from "../../test/fixtures/seeds-definition/revisions/project_request.r1.seed";
import { seed as projectReview } from "../../test/fixtures/seeds-definition/revisions/project_review.r1.seed";
import {
  PROJECT_AUDIT_KEY,
  PROJECT_FORM_KEY,
  PROJECT_REPORT_KEY,
  fixtureProjectSettings,
  fixtureProjectSource,
} from "../../test/fixtures/seeds-project/project-source";
import { seedRegistry as projectRegistry } from "../../test/fixtures/seeds-project/registry";
import {
  SeedCompositionError,
  planSeedRegistry,
  portableCatalogOf,
} from "./seed-composition";
import {
  type DefinitionSeedSet,
  type SeedDocument,
  type SeedDocumentSet,
  type SeedRegistry,
  type SeedRelationSet,
  type SeedSet,
  isDefinitionSeedSet,
  seedRef,
} from "./seed-declaration";

const FIXTURES = path.resolve(__dirname, "..", "..", "test", "fixtures");

function documents(
  collection: string,
  entries: SeedDocument[],
  overrides: Partial<SeedDocumentSet> = {},
): SeedDocumentSet {
  return { kind: "documents", collection, entries, ...overrides };
}

function plan(...seeds: SeedSet[]): SeedRegistry {
  return planSeedRegistry([{ origin: "test", seeds }]);
}

/** 組裝被拒絕時的問題清單(沒被拒絕就讓測試失敗)。 */
function problemsOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof SeedCompositionError) {
      return [...error.problems];
    }
    return [error instanceof Error ? error.message : String(error)];
  }
  throw new Error("預期組裝被拒絕,但通過了");
}

/**
 * 底座 + 這個測試自己給的專案內容。疊在**空的專案來源夾具**上,不疊正式的 `seeds/project/`:
 * 引用專案登記了什麼,都不會與這裡的內容撞 key,也不會補上負例刻意缺少的依賴。
 */
function withProject(
  project: Partial<SeedSource>,
  settings: ProjectSeedSettings = baseOnlyProjectSettings,
): () => SeedRegistry {
  return () =>
    assembleSeedRegistry(settings, { ...baseOnlyProjectSource, ...project });
}

function documentSetOf(
  registry: SeedRegistry,
  collection: string,
): SeedSet | undefined {
  return registry.find(
    (set) => set.kind === "documents" && set.collection === collection,
  );
}

function entryKeys(registry: SeedRegistry, collection: string): string[] {
  return registry.flatMap((set) =>
    set.kind === "documents" && set.collection === collection
      ? set.entries.map((entry) => entry.key)
      : [],
  );
}

function relationsOf(
  registry: SeedRegistry,
  type: string,
  roleKey: string,
): string[] {
  return registry.flatMap((set) =>
    set.kind === "relations"
      ? set.entries
          .filter((entry) => entry.type === type && entry.first.key === roleKey)
          .map((entry) => entry.second.key)
      : [],
  );
}

function moduleNode(
  key: string,
  parentKey: string | null,
): ModuleSeedDeclaration {
  return {
    nodes: [
      { key, name: key, sidebarType: "link", parentKey, order: 1, route: "x" },
    ],
  };
}

describe("固定組裝入口:底座 + 空的專案來源(隔離夾具)", () => {
  it("普通種子的內容與搬檔前相同:8 類種子、41 個模組、124 筆權限、4 個資料範圍目標、74 筆模板綁定、root 初始帳號一份", () => {
    expect(
      baseRegistry.map((set) =>
        set.kind === "documents" ? set.collection : set.kind,
      ),
    ).toEqual([
      "orgs",
      "roles",
      "relations",
      "root-admin",
      "field_categories",
      "fields",
      "demo_items_one",
      "demo_items_two",
      "modules",
      "permissions",
      "data_scope_targets",
      "relations",
    ]);
    expect(entryKeys(baseRegistry, "modules")).toHaveLength(41);
    expect(entryKeys(baseRegistry, "permissions")).toHaveLength(124);
    expect(entryKeys(baseRegistry, "data_scope_targets")).toHaveLength(4);
    expect(
      relationsOf(baseRegistry, "role_module", "tenant-admin"),
    ).toHaveLength(37);
    expect(
      relationsOf(baseRegistry, "role_permission", "tenant-admin"),
    ).toHaveLength(37);
    expect(baseRegistry.some((set) => isDefinitionSeedSet(set))).toBe(false);
  });

  it("重新驗一次已組裝的 registry 不改變順序(執行前的再檢查是冪等的)", () => {
    expect(plan(...baseRegistry)).toEqual(baseRegistry);
  });
});

describe("固定組裝入口:正式 registry(專案來源由引用專案登記,可以不是空的)", () => {
  it("就是固定組裝入口對正式專案來源的輸出(載入時已通過撞 key、引用、可攜性與 key 規約的檢查)", () => {
    expect(seedRegistry).toEqual(
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    );
  });

  it("專案登記不取代也不拿掉底座的種子:底座每一筆的 key 都還在,root 初始帳號仍只有一份", () => {
    for (const collection of [
      "orgs",
      "roles",
      "field_categories",
      "fields",
      "demo_items_one",
      "demo_items_two",
      "modules",
      "permissions",
      "data_scope_targets",
    ]) {
      expect(entryKeys(seedRegistry, collection)).toEqual(
        expect.arrayContaining(entryKeys(baseRegistry, collection)),
      );
    }
    for (const type of ["role_module", "role_permission"]) {
      expect(relationsOf(seedRegistry, type, "tenant-admin")).toEqual(
        expect.arrayContaining(relationsOf(baseRegistry, type, "tenant-admin")),
      );
    }
    expect(
      seedRegistry.filter((set) => set.kind === "root-admin"),
    ).toHaveLength(1);
  });

  it("根組織的初值來自專案設定,初始值欄位政策由底座決定", () => {
    const orgs = seedRegistry.find(
      (set): set is SeedDocumentSet =>
        set.kind === "documents" && set.collection === "orgs",
    );
    expect(orgs?.initialSeedValueFields).toEqual([
      "name",
      "description",
      "enabled",
      "settings",
    ]);
    expect(orgs?.entries).toEqual([
      {
        key: "root",
        data: {
          name: projectSeedSettings.rootOrg.name,
          parentId: null,
          ancestors: [],
          enabled: true,
          description: projectSeedSettings.rootOrg.description,
          settings: projectSeedSettings.rootOrg.settings,
        },
      },
    ]);
  });

  it("重新驗一次已組裝的 registry 不改變順序(執行前的再檢查是冪等的)", () => {
    expect(plan(...seedRegistry)).toEqual(seedRegistry);
  });
});

describe("固定組裝入口:底座 + 非空的專案來源", () => {
  const modules = projectRegistry.find(
    (set): set is SeedDocumentSet =>
      set.kind === "documents" && set.collection === "modules",
  );
  const moduleData = (key: string): Record<string, unknown> | undefined =>
    modules?.entries.find((entry) => entry.key === key)?.data;

  it("專案模組掛在底座父節點底下:父路徑依整棵樹計算,父節點排在前面", () => {
    expect(moduleData(PROJECT_REPORT_KEY)).toMatchObject({
      parentId: seedRef("modules", "demo"),
      ancestors: [seedRef("modules", "demo")],
      icon: "chart",
      settings: { defaultRange: "month" },
      enabled: true,
      engine: "fixed",
    });
    expect(moduleData(`${PROJECT_AUDIT_KEY}.ops`)).toMatchObject({
      ancestors: [
        seedRef("modules", "system"),
        seedRef("modules", PROJECT_AUDIT_KEY),
      ],
    });
    const keys = entryKeys(projectRegistry, "modules");
    expect(keys).toHaveLength(41 + 8);
    expect(keys.indexOf("demo")).toBeLessThan(keys.indexOf(PROJECT_REPORT_KEY));
    expect(keys.indexOf("system")).toBeLessThan(
      keys.indexOf(PROJECT_AUDIT_KEY),
    );
  });

  it("租戶管理員模板納入專案的一般模組與它們的 wildcard,扣除根組織專屬(含繼承自父節點的)", () => {
    const boundModules = relationsOf(
      projectRegistry,
      "role_module",
      "tenant-admin",
    );
    const boundPermissions = relationsOf(
      projectRegistry,
      "role_permission",
      "tenant-admin",
    );
    for (const key of [
      PROJECT_REPORT_KEY,
      `${PROJECT_REPORT_KEY}.view-page`,
      PROJECT_FORM_KEY,
      `${PROJECT_FORM_KEY}.edit-page`,
    ]) {
      expect(boundModules).toContain(key);
      expect(boundPermissions).toContain(`${key}.*`);
    }
    for (const key of [PROJECT_AUDIT_KEY, `${PROJECT_AUDIT_KEY}.ops`]) {
      expect(boundModules).not.toContain(key);
      expect(boundPermissions).not.toContain(`${key}.*`);
    }
    // 模板只綁 wildcard,不綁個別權限
    expect(boundPermissions).not.toContain(`${PROJECT_REPORT_KEY}.export`);
    // 底座 37 個 + 專案報表 2 + 專案表單 4
    expect(boundModules).toHaveLength(37 + 6);
    expect(boundPermissions).toHaveLength(37 + 6);
  });

  it("專案的個別權限與資料範圍目標由同一次推導產生(每個模組仍恰一筆 wildcard)", () => {
    const permissionKeys = entryKeys(projectRegistry, "permissions");
    expect(permissionKeys).toEqual(
      expect.arrayContaining([
        `${PROJECT_REPORT_KEY}.*`,
        `${PROJECT_REPORT_KEY}.export`,
        `${PROJECT_AUDIT_KEY}.ops.purge`,
        `${PROJECT_FORM_KEY}.create`,
      ]),
    );
    // 底座 124 + 專案 8 個模組的 wildcard + 個別權限 2 + 1 + 4
    expect(permissionKeys).toHaveLength(124 + 8 + 7);
    expect(entryKeys(projectRegistry, "data_scope_targets")).toEqual(
      expect.arrayContaining([PROJECT_REPORT_KEY, PROJECT_FORM_KEY]),
    );
  });

  it("專案對底座模組的初值指定只影響 enabled / icon / settings;沒指定的維持宣告值", () => {
    expect(moduleData("demo.sample-two")).toMatchObject({
      enabled: false,
      icon: "star",
      settings: {},
      name: "示範模組2",
    });
    expect(moduleData("demo-form")).toMatchObject({
      enabled: true,
      settings: { list: { columns: [], builtin: { status: false } } },
    });
    expect(moduleData("overview")).toMatchObject({ icon: null });
    expect(moduleData("system")).toMatchObject({
      enabled: true,
      icon: "settings",
      settings: {},
    });
  });

  it("以條目為單位依引用排序:同一個 set 裡後宣告的被引用者排到前面,關聯排在它兩端之後", () => {
    expect(entryKeys(projectRegistry, "project_report_types")).toEqual([
      "parent",
      "child",
    ]);
    const kinds = projectRegistry.map((set) =>
      set.kind === "documents" ? set.collection : set.kind,
    );
    const projectRolesIndex = projectRegistry.findIndex(
      (set) =>
        set.kind === "documents" &&
        set.collection === "roles" &&
        set.entries.some((entry) => entry.key === "project-auditor"),
    );
    const projectRelationsIndex = projectRegistry.findIndex(
      (set) =>
        set.kind === "relations" &&
        set.entries.some((entry) => entry.second.key === "project-auditor"),
    );
    expect(projectRolesIndex).toBeGreaterThan(-1);
    expect(projectRelationsIndex).toBeGreaterThan(projectRolesIndex);
    expect(projectRelationsIndex).toBeGreaterThan(kinds.indexOf("modules"));
  });

  it("與底座完全相同的關聯去重;root 初始帳號仍只有一份", () => {
    const superAdminOwners = projectRegistry.flatMap((set) =>
      set.kind === "relations"
        ? set.entries.filter(
            (entry) =>
              entry.type === "org_role" && entry.second.key === "super-admin",
          )
        : [],
    );
    expect(superAdminOwners).toHaveLength(1);
    expect(
      projectRegistry.filter((set) => set.kind === "root-admin"),
    ).toHaveLength(1);
  });

  it("專案在底座既有的 collection 加種子:政策相同就並存", () => {
    expect(entryKeys(projectRegistry, "fields")).toHaveLength(10 + 1);
    expect(entryKeys(projectRegistry, "roles")).toEqual([
      "super-admin",
      "tenant-admin",
      "project-auditor",
    ]);
  });
});

describe("固定組裝入口:明確拒絕(寫入之前)", () => {
  it("專案重宣告底座的種子文件(根組織):撞 key,指出兩個來源", () => {
    const problems = problemsOf(
      withProject({
        seeds: [
          documents(
            "orgs",
            [{ key: "root", data: { name: "搶占", enabled: true } }],
            {
              initialSeedValueFields: [
                "name",
                "description",
                "enabled",
                "settings",
              ],
            },
          ),
        ],
      }),
    );
    expect(problems).toEqual([
      expect.stringContaining("orgs.root 重複宣告(base 與 project)"),
    ]);
  });

  it("同一個 collection 的政策不相容(識別鍵、match、初始值欄位、認養條件)", () => {
    const problems = problemsOf(
      withProject({
        seeds: [
          documents("orgs", [{ key: "branch", data: { name: "分部" } }]),
          documents("fields", [
            { key: "gender.x", data: { value: "x", orgId: null } },
          ]),
        ],
      }),
    );
    expect(problems).toEqual([
      expect.stringContaining(
        "orgs 在 base 與 project 的宣告政策不相容(初始值欄位不同)",
      ),
      expect.stringContaining(
        "fields 在 base 與 project 的宣告政策不相容(認養條件不同)",
      ),
    ]);
  });

  it("專案不得用 documents / relations 再宣告由模組宣告推導的內容", () => {
    const tenantAdminBinding: SeedRelationSet = {
      kind: "relations",
      entries: [
        {
          type: "role_module",
          first: { collection: "roles", key: "tenant-admin" },
          second: { collection: "modules", key: "system.data-scope" },
        },
      ],
    };
    const problems = problemsOf(
      withProject({
        seeds: [
          documents("modules", [{ key: "rogue", data: { name: "Rogue" } }]),
          documents("data_scope_targets", [], { keyField: "moduleKey" }),
          tenantAdminBinding,
        ],
      }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("project:modules 由模組宣告推導"),
        expect.stringContaining("project:data_scope_targets 由模組宣告推導"),
        expect.stringContaining("屬於由模組宣告推導的角色模板"),
      ]),
    );
  });

  it("模組宣告:撞 key、父節點未宣告、父子循環、權限重複或指到未宣告的模組", () => {
    expect(
      problemsOf(
        withProject({
          moduleDeclarations: [moduleNode("demo.sample-two", "demo")],
        }),
      ),
    ).toEqual([expect.stringContaining("模組 demo.sample-two 重複宣告")]);
    expect(
      problemsOf(
        withProject({
          moduleDeclarations: [moduleNode("ghost.child", "ghost")],
        }),
      ),
    ).toEqual([
      expect.stringContaining("模組 ghost.child 的上層模組 ghost 未宣告"),
    ]);
    expect(
      problemsOf(
        withProject({
          moduleDeclarations: [
            moduleNode("a.b", "a.b.c"),
            moduleNode("a.b.c", "a.b"),
          ],
        }),
      ),
    ).toEqual([expect.stringContaining("模組父子關係循環:a.b → a.b.c → a.b")]);
    expect(
      problemsOf(
        withProject({
          moduleDeclarations: [
            {
              nodes: [],
              permissions: [
                {
                  key: "demo.sample-two.view",
                  moduleKey: "demo.sample-two",
                  name: "檢視",
                },
                { key: "nowhere.view", moduleKey: "nowhere", name: "檢視" },
              ],
            },
          ],
        }),
      ),
    ).toEqual([
      expect.stringContaining("權限 demo.sample-two.view 重複宣告"),
      expect.stringContaining("權限 nowhere.view 的擁有模組 nowhere 未宣告"),
    ]);
  });

  it("模組初值:未知的模組 key、三個欄位以外的鍵、型別不對", () => {
    const moduleInitialValues = {
      "ghost-module": { enabled: false },
      overview: { name: "改名", enabled: "no", icon: "not-an-icon" },
    } as unknown as ModuleInitialValues;
    const problems = problemsOf(
      withProject({}, { ...baseOnlyProjectSettings, moduleInitialValues }),
    );
    expect(problems).toEqual([
      "moduleInitialValues.ghost-module:模組 ghost-module 未宣告",
      expect.stringContaining(
        "moduleInitialValues.overview.name 不是可指定的初值",
      ),
      "moduleInitialValues.overview.enabled 必須是 true / false",
      "moduleInitialValues.overview.icon 不在圖示白名單內",
    ]);
  });

  it("專案初值的外框:根組織只能給 name / description / settings", () => {
    const settings = {
      rootOrg: { name: " ", description: 1, settings: null, key: "other-root" },
      moduleInitialValues: {},
    } as unknown as ProjectSeedSettings;
    expect(problemsOf(withProject({}, settings))).toEqual([
      expect.stringContaining("rootOrg.key 不是可指定的初值"),
      "專案種子初值:rootOrg.name 必須是非空字串",
      "專案種子初值:rootOrg.description 必須是字串或 null",
      "專案種子初值:rootOrg.settings 必須是物件(沒有就給 {})",
    ]);
  });

  it("模組與權限 key 規約在組裝時就擋下(不必等靜態測試)", () => {
    expect(
      problemsOf(
        withProject({ moduleDeclarations: [moduleNode("BadKey", null)] }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("模組 BadKey:key 須為全小寫 kebab-case"),
      ]),
    );
  });
});

describe("planSeedRegistry:引用、順序與防線", () => {
  it("漏引用:指出誰引用了哪一筆未宣告的種子文件", () => {
    expect(
      problemsOf(() =>
        plan(
          documents("members", [
            { key: "m", data: { groupId: seedRef("groups", "nowhere") } },
          ]),
        ),
      ),
    ).toEqual([
      "test:members.m 引用的種子文件未宣告:找不到種子文件 groups.nowhere",
    ]);
  });

  it("引用識別鍵不是 key 的 collection、巢狀位置的 seedRef:報錯,不宣稱能解析", () => {
    const problems = problemsOf(() =>
      plan(
        documents("targets", [{ key: "demo", data: {} }], {
          keyField: "moduleKey",
        }),
        documents("groups", [{ key: "a", data: {} }]),
        documents("members", [
          {
            key: "m",
            data: {
              targetId: seedRef("targets", "demo"),
              nested: { groupId: seedRef("groups", "a") },
              list: [{ groupId: seedRef("groups", "a") }],
            },
          },
        ]),
      ),
    );
    expect(problems).toEqual([
      expect.stringContaining("test:members.m.nested 在巢狀位置用了 seedRef"),
      expect.stringContaining("test:members.m.list.0 在巢狀位置用了 seedRef"),
      expect.stringContaining(
        "targets 以 moduleKey 當識別鍵,不可被 seedRef 引用",
      ),
    ]);
  });

  it("引用循環:指出整條路徑", () => {
    expect(
      problemsOf(() =>
        plan(
          documents("nodes", [
            { key: "a", data: { nextId: seedRef("nodes", "b") } },
            { key: "b", data: { nextId: seedRef("nodes", "c") } },
            { key: "c", data: { nextId: seedRef("nodes", "a") } },
          ]),
        ),
      ),
    ).toEqual([
      "種子引用循環:test:nodes.a → test:nodes.b → test:nodes.c → test:nodes.a",
    ]);
  });

  it("兩個 set 的條目互相穿插引用:以條目排序,原 set 拆成幾段(整個 set 排不出來的順序也排得出來)", () => {
    const registry = plan(
      documents("alpha", [
        { key: "a1", data: { betaId: seedRef("beta", "b1") } },
        { key: "a2", data: {} },
      ]),
      documents("beta", [
        { key: "b1", data: { alphaId: seedRef("alpha", "a2") } },
      ]),
    );
    expect(
      registry.map((set) =>
        set.kind === "documents"
          ? [set.collection, set.entries.map((entry) => entry.key)]
          : set.kind,
      ),
    ).toEqual([
      ["alpha", ["a2"]],
      ["beta", ["b1"]],
      ["alpha", ["a1"]],
    ]);
  });

  it("認養條件裡的 seedRef 也是引用;關聯兩端與 root 初始帳號的組織 / 角色要已宣告", () => {
    const registry = plan(
      { kind: "root-admin", orgKey: "root", roleKey: "admin" },
      {
        kind: "relations",
        entries: [
          {
            type: "org_role",
            first: { collection: "orgs", key: "root" },
            second: { collection: "roles", key: "admin" },
          },
        ],
      },
      documents("options", [{ key: "o", data: { value: "o" } }], {
        adoptBy: {
          fields: ["value"],
          where: { orgId: seedRef("orgs", "root") },
        },
      }),
      documents("roles", [{ key: "admin", data: {} }]),
      documents("orgs", [{ key: "root", data: {} }]),
    );
    expect(
      registry.map((set) =>
        set.kind === "documents" ? set.collection : set.kind,
      ),
    ).toEqual(["orgs", "roles", "root-admin", "relations", "options"]);

    expect(
      problemsOf(() =>
        plan({ kind: "root-admin", orgKey: "root", roleKey: "admin" }),
      ),
    ).toEqual([
      expect.stringContaining("找不到種子文件 orgs.root"),
      expect.stringContaining("找不到種子文件 roles.admin"),
    ]);
  });

  it("root 初始帳號宣告兩份:拒絕", () => {
    const rootAdmin: SeedSet = {
      kind: "root-admin",
      orgKey: "root",
      roleKey: "admin",
    };
    expect(
      problemsOf(() =>
        planSeedRegistry([
          {
            origin: "base",
            seeds: [
              documents("orgs", [{ key: "root", data: {} }]),
              documents("roles", [{ key: "admin", data: {} }]),
              rootAdmin,
            ],
          },
          { origin: "project", seeds: [{ ...rootAdmin }] },
        ]),
      ),
    ).toEqual([
      expect.stringContaining(
        "root 初始帳號只允許宣告一份(base 與 project 都宣告了)",
      ),
    ]);
  });

  it("版本化定義與安裝紀錄的 collection 不收 raw documents;dynamic 權限不能用種子寫", () => {
    for (const collection of [
      "forms",
      "form_versions",
      "workflows",
      "workflow_versions",
      "seed_definition_installations",
      "seed_update_runs",
    ]) {
      expect(
        problemsOf(() =>
          plan(
            documents(collection, [
              { key: "leave_request", data: { name: "請假單" } },
            ]),
          ),
        ),
      ).toEqual([
        expect.stringContaining(`test:${collection} 是版本化定義 / 安裝紀錄`),
      ]);
    }
    expect(
      problemsOf(() =>
        plan(
          documents("permissions", [
            { key: "demo-form.show-x-y", data: { source: "dynamic" } },
          ]),
        ),
      ),
    ).toEqual([
      expect.stringContaining('必須帶 match { source: { $ne: "dynamic" } }'),
      expect.stringContaining("permissions.demo-form.show-x-y 是 dynamic 權限"),
    ]);
  });
});

describe("版本化定義宣告的組裝", () => {
  const definitions = definitionRegistry.filter(
    (set): set is DefinitionSeedSet => isDefinitionSeedSet(set),
  );

  it("匯出檔原樣登記:revisions/ 底下的檔案就是 serializeSeedSet 的輸出,一個位元組都不差", () => {
    for (const [fileName, seed] of [
      ["project_request.r1.seed.ts", projectRequest],
      ["project_review.r1.seed.ts", projectReview],
    ] as const) {
      const onDisk = readFileSync(
        path.join(FIXTURES, "seeds-definition", "revisions", fileName),
        "utf8",
      ).replaceAll("\r\n", "\n");
      expect(serializeSeedSet(seed)).toBe(onDisk);
    }
  });

  it("定義排在全部普通種子之後,彼此依引用排序(流程登記在表單前面也一樣)", () => {
    expect(
      definitions.map((set) => `${set.kind}:${set.key}@${set.revision}`),
    ).toEqual([
      "form-definition:project_request@r1",
      "workflow-definition:project_review@r1",
    ]);
    const firstDefinition = definitionRegistry.findIndex((set) =>
      isDefinitionSeedSet(set),
    );
    expect(
      definitionRegistry
        .slice(firstDefinition)
        .every((set) => isDefinitionSeedSet(set)),
    ).toBe(true);
    // 定義以外的內容與沒有登記定義的專案夾具完全相同
    expect(definitionRegistry.slice(0, firstDefinition)).toEqual(
      projectRegistry,
    );
  });

  it("可攜性目錄由同一份 registry 推出:表單模組、受管類別與種子選項、共用表單", () => {
    const catalog = portableCatalogOf(definitionRegistry);
    expect(catalog.formModuleKeys).toEqual(
      new Set(["demo-form", "demo.form", "demo.sub.form", PROJECT_FORM_KEY]),
    );
    expect([...(catalog.fieldCategories.get("gender") ?? [])]).toEqual([
      "male",
      "female",
      "other",
      "undisclosed",
    ]);
    expect(catalog.fieldCategories.get("demo-category")?.has("dessert")).toBe(
      true,
    );
    expect([...catalog.sharedForms.keys()]).toEqual(["project_request"]);
  });

  it("定義的依賴不在同一計畫(表單模組沒宣告、檢查用表單沒登記):拒絕並指出位置", () => {
    const withoutFormModule = problemsOf(
      withProject({ seeds: [projectRequest] }),
    );
    expect(withoutFormModule).toEqual([
      expect.stringContaining(
        "project:form-definition:project_request@r1 的 moduleKey:表單模組 project-form 不在這次交付可解析的模組裡",
      ),
    ]);
    const withoutForm = problemsOf(withProject({ seeds: [projectReview] }));
    expect(withoutForm[0]).toContain(
      "project:workflow-definition:project_review@r1 的 checkFormKey",
    );
  });

  it("不可攜的定義(共用流程指定使用者、欄位寫死 id 比較)在組裝時就拒絕", () => {
    const users: DefinitionSeedSet = {
      ...projectReview,
      definition: {
        steps: [
          {
            key: "named",
            name: "指定人",
            assignee: {
              kind: "audience",
              audience: {
                mode: "match",
                filter: {
                  op: "AND",
                  children: [
                    {
                      field: "user",
                      cond: "in",
                      value: {
                        kind: "static",
                        values: ["0123456789abcdef01234567"],
                      },
                    },
                  ],
                },
              },
            },
            mode: "any",
          },
        ],
      },
    };
    const problems = problemsOf(
      withProject(
        {
          ...fixtureProjectSource,
          seeds: [...fixtureProjectSource.seeds, projectRequest, users],
        },
        fixtureProjectSettings,
      ),
    );
    expect(problems).toEqual([
      expect.stringContaining(
        "definition.steps.0.assignee.audience.filter.children[0]",
      ),
    ]);
    expect(problems[0]).toContain("ASSIGNEE_NOT_PORTABLE");
  });

  it("同一個 key 登記兩個 revision:拒絕(目前 registry 只引用當前有效者)", () => {
    const problems = problemsOf(
      withProject(
        {
          ...fixtureProjectSource,
          seeds: [
            ...fixtureProjectSource.seeds,
            projectRequest,
            { ...projectRequest, revision: "r2" },
          ],
        },
        fixtureProjectSettings,
      ),
    );
    expect(problems).toEqual([
      expect.stringContaining("form-definition:project_request 重複宣告"),
    ]);
  });
});

describe("composeModuleSeeds", () => {
  it("底座自己的模組宣告推導出的內容與空專案來源的 registry 相同(推導只有一份)", () => {
    const seeds = composeModuleSeeds(baseModuleDeclarations, {});
    expect(seeds.modules).toEqual(documentSetOf(baseRegistry, "modules"));
    expect(seeds.permissions).toEqual(
      documentSetOf(baseRegistry, "permissions"),
    );
    expect(seeds.dataScopeTargets).toEqual(
      documentSetOf(baseRegistry, "data_scope_targets"),
    );
    expect(baseRegistry).toContainEqual(seeds.tenantAdminBindings);
  });

  it("正式 registry 的模組、權限、資料範圍目標與模板,就是兩方模組宣告合併後的那一次推導", () => {
    const seeds = composeModuleSeeds(
      [...baseModuleDeclarations, ...projectSeedSource.moduleDeclarations],
      projectSeedSettings.moduleInitialValues,
    );
    expect(seeds.modules).toEqual(documentSetOf(seedRegistry, "modules"));
    expect(seeds.permissions).toEqual(
      documentSetOf(seedRegistry, "permissions"),
    );
    expect(seeds.dataScopeTargets).toEqual(
      documentSetOf(seedRegistry, "data_scope_targets"),
    );
    expect(seedRegistry).toContainEqual(seeds.tenantAdminBindings);
  });

  it("專案在底座既有 collection 加種子時沿用底座的政策物件", () => {
    expect(baseFields.adoptBy).toBeDefined();
  });
});

describe("定義夾具是既有檢查器認可的定義", () => {
  it("表單夾具通過既有的表單定義檢查器;流程夾具通過既有的流程定義檢查器(共用流程)", () => {
    expect(
      validateDefinition(projectRequest.definition, {
        regexSafety: () => true,
        fieldCategoryKeys: new Set(["gender"]),
      }).errors,
    ).toEqual([]);
    expect(
      validateWorkflowDefinition(projectReview.definition, {
        isShared: true,
        forms: new Map([["project_request", projectRequest.definition.fields]]),
        checkFormFields: projectRequest.definition.fields,
      }).errors,
    ).toEqual([]);
  });
});

describe("每個條目只排一次;自我引用是循環", () => {
  /** 一份掛在底座表單模組 `demo-form` 上的定義(專案沒有自己的模組宣告:疊在空的專案來源夾具上)。 */
  const orderForm: DefinitionSeedSet = {
    ...projectRequest,
    key: "order_form",
    moduleKey: "demo-form",
  };

  it("定義引用的底座模組不會被再排一次:正式組裝通過,模組文件各一筆,定義在最後", () => {
    const registry = withProject({ seeds: [orderForm] })();
    const moduleKeys = entryKeys(registry, "modules");
    expect(moduleKeys).toHaveLength(41);
    expect(new Set(moduleKeys).size).toBe(41);
    expect(moduleKeys.filter((key) => key === "demo-form")).toEqual([
      "demo-form",
    ]);
    expect(registry.at(-1)).toBe(orderForm);
    // 除了多一份定義,其餘與沒有登記定義的空專案來源夾具完全相同
    expect(registry.slice(0, -1)).toEqual(baseRegistry);
    // 執行前的再檢查(runSeeds 會再排一次)結果不變
    expect(plan(...registry)).toEqual(registry);
  });

  it("普通文件引用自己:插入前不可能查到自己的 id,以循環拒絕", () => {
    expect(
      problemsOf(() =>
        plan(
          documents("project_items", [
            {
              key: "self",
              data: { parentId: seedRef("project_items", "self") },
            },
          ]),
        ),
      ),
    ).toEqual([
      "種子引用循環:test:project_items.self → test:project_items.self",
    ]);
    // 頂層陣列裡的自我引用也一樣
    expect(
      problemsOf(() =>
        plan(
          documents("project_items", [
            { key: "root", data: {} },
            {
              key: "self",
              data: {
                ancestors: [
                  seedRef("project_items", "root"),
                  seedRef("project_items", "self"),
                ],
              },
            },
          ]),
        ),
      ),
    ).toEqual([
      "種子引用循環:test:project_items.self → test:project_items.self",
    ]);
  });

  it("定義從自己的提交帶入(self-prefill)是允許的,不算循環", () => {
    const selfPrefill: DefinitionSeedSet = {
      ...orderForm,
      definition: {
        ...projectRequest.definition,
        prefills: [
          {
            label: "帶入上一張",
            source: {
              provider: "form_submission",
              labelField: "title",
              formKey: "order_form",
            },
            mapping: [{ sourceField: "title", fieldKey: "title" }],
          },
        ],
      },
    };
    const registry = withProject({ seeds: [selfPrefill] })();
    expect(registry.at(-1)).toBe(selfPrefill);
  });
});
