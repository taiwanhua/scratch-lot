import { describe, expect, it } from "@jest/globals";

import { ModuleSidebarType } from "@repo/graphql";

import { isPermissionContainer } from "./module-admin-tree";
import type { ModuleAdminNodeLike } from "./module-manager-types";

const node = (
  overrides: Partial<ModuleAdminNodeLike>,
): ModuleAdminNodeLike => ({
  id: "m-1",
  key: "demo",
  name: "節點",
  parentId: null,
  sidebarType: ModuleSidebarType.Hidden,
  route: null,
  order: 1,
  description: null,
  icon: null,
  enabled: true,
  permissions: [],
  children: [],
  ...overrides,
});

/**
 * 「權限容器」的判準(改讀 `moduleTree` 回的 `route`)。
 * 這幾個案子的重點是**新舊判準會分歧的地方** —— 舊判準看 key 是不是以 `-page` 結尾,
 * 靠的是 seed 的命名規約;現在看的是「有沒有 route」這件事本身。
 */
describe("isPermissionContainer(權限容器 = hidden 且沒有 route)", () => {
  it("hidden 且沒有 route → 是權限容器", () => {
    expect(isPermissionContainer(node({ key: "api", route: null }))).toBe(true);
  });

  it("hidden 但有 route → 是隱藏頁,不是權限容器", () => {
    expect(
      isPermissionContainer(
        node({ key: "demo.sub.sample-one.view-page", route: "view-page" }),
      ),
    ).toBe(false);
  });

  it("key 不以 -page 結尾、但有 route → 仍是隱藏頁(舊判準會誤判成權限容器)", () => {
    expect(
      isPermissionContainer(
        node({ key: "demo.sub.preview", route: "preview" }),
      ),
    ).toBe(false);
  });

  it("key 以 -page 結尾、卻沒有 route → 仍是權限容器(舊判準會誤判成隱藏頁)", () => {
    expect(
      isPermissionContainer(node({ key: "demo.sub.legacy-page", route: null })),
    ).toBe(true);
  });

  it("不是 hidden 的節點一律不是權限容器", () => {
    expect(
      isPermissionContainer(
        node({ sidebarType: ModuleSidebarType.Group, route: null }),
      ),
    ).toBe(false);
  });

  it("route 欄位缺席(舊快取 / 未選取該欄位)視同沒有 route", () => {
    const withoutRoute: ModuleAdminNodeLike = { ...node({ key: "api" }) };
    delete withoutRoute.route;
    expect(isPermissionContainer(withoutRoute)).toBe(true);
  });
});
