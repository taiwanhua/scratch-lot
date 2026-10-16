import { describe, expect, it } from "@jest/globals";

import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import {
  type ShellModule,
  buildNavTree,
  enterableRouteMap,
  firstLinkRoute,
} from "./module-tree";

const system: ShellModule = {
  id: "m-system",
  key: "system",
  name: "系統管理",
  parentId: null,
  sidebarType: ModuleSidebarType.Group,
  engine: ModuleEngine.Fixed,
  order: 1,
  route: "/system",
  permissions: ["system.*"],
};
const orgManager: ShellModule = {
  id: "m-org",
  key: "system.org-manager",
  name: "組織管理",
  parentId: "m-system",
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order: 1,
  route: "/system/org-manager",
  permissions: ["system.org-manager.*"],
};
const userManager: ShellModule = {
  id: "m-user",
  key: "system.user-manager",
  name: "使用者管理",
  parentId: "m-system",
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order: 2,
  route: "/system/user-manager",
  permissions: [],
};
const demo: ShellModule = {
  id: "m-demo",
  key: "demo",
  name: "示範群組",
  parentId: null,
  sidebarType: ModuleSidebarType.Group,
  engine: ModuleEngine.Fixed,
  order: 2,
  route: "/demo",
  permissions: [],
};
const sampleTwo: ShellModule = {
  id: "m-sample-two",
  key: "demo.sample-two",
  name: "示範模組2",
  parentId: "m-demo",
  sidebarType: ModuleSidebarType.Link,
  engine: ModuleEngine.Fixed,
  order: 2,
  route: "/demo/sample-two",
  permissions: [],
};
const sampleTwoEditPage: ShellModule = {
  id: "m-sample-two-edit",
  key: "demo.sample-two.edit-page",
  name: "編輯",
  parentId: "m-sample-two",
  sidebarType: ModuleSidebarType.Hidden,
  engine: ModuleEngine.Fixed,
  order: 3,
  route: "/demo/sample-two/edit-page",
  permissions: [],
};
const apiTree: ShellModule = {
  id: "m-api",
  key: "api",
  name: "API 能力",
  parentId: null,
  sidebarType: ModuleSidebarType.Hidden,
  engine: ModuleEngine.Fixed,
  order: 99,
  route: null,
  permissions: [],
};

// 故意打亂順序:陣列順序不可信,一律依 order 重排
const modules = [
  sampleTwoEditPage,
  userManager,
  demo,
  apiTree,
  sampleTwo,
  orgManager,
  system,
];

describe("模組陣列 → 側欄樹(ADR-0011「前端判斷」:以 parentId 組樹、hidden 不顯示、依 order 排序)", () => {
  it("以 parentId 組樹,同層依 order 排序", () => {
    const tree = buildNavTree(modules);

    expect(tree.map((node) => node.module.key)).toEqual(["system", "demo"]);
    expect(tree[0]?.children.map((node) => node.module.key)).toEqual([
      "system.org-manager",
      "system.user-manager",
    ]);
  });

  it("hidden 模組與 route 為 null 的 api 樹不進側欄", () => {
    const tree = buildNavTree(modules);
    const keys = new Set<string>();
    const walk = (nodes: typeof tree) => {
      for (const node of nodes) {
        keys.add(node.module.key);
        walk(node.children);
      }
    };
    walk(tree);

    expect(keys.has("demo.sample-two.edit-page")).toBe(false);
    expect(keys.has("api")).toBe(false);
    expect(keys.has("demo.sample-two")).toBe(true);
  });

  it("firstLinkRoute:側欄順序深度優先第一個 link — `/` 用整棵樹、群組路由用該群組的子樹,同一個函式", () => {
    const tree = buildNavTree(modules);
    // `/`:整棵樹第一個 link(第一個頂層是「系統管理」群組 → 鑽進去)
    expect(firstLinkRoute(tree)).toBe("/system/org-manager");
    // 群組路由:該群組的子樹
    expect(firstLinkRoute(tree[0]?.children ?? [])).toBe("/system/org-manager");
    expect(firstLinkRoute(tree[1]?.children ?? [])).toBe("/demo/sample-two");
    // 只有空群組 → 一個都沒有
    expect(firstLinkRoute(buildNavTree([system]))).toBeNull();
    expect(firstLinkRoute([])).toBeNull();
  });
});

describe("可進入路由集合(ADR-0011「路由防守」:可進 = 有那個模組路由,僅此一條)", () => {
  it("link 與 hidden 都可進入;群組與 api 樹不在集合內", () => {
    const routes = enterableRouteMap(modules);

    expect(routes.get("/system/org-manager")?.name).toBe("組織管理");
    expect(routes.get("/demo/sample-two/edit-page")?.name).toBe("編輯");
    expect(routes.has("/system")).toBe(false);
    expect(routes.has("/demo")).toBe(false);
    expect([...routes.values()].some((module) => module.key === "api")).toBe(
      false,
    );
  });
});
