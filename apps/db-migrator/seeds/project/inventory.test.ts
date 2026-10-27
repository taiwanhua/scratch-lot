import { describe, expect, it } from "@jest/globals";

import { INVENTORY_PERMISSIONS } from "@repo/domain/project/lottery";

import { assembleSeedRegistry } from "../registry";
import { inventoryModule } from "./inventory";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { projectSeedSource } from "./registry";
import { projectSeedSettings } from "./settings";

describe("庫存管理的模組宣告(規格 3.1、3.2)", () => {
  it("一個側欄連結(order 20)+ 本的詳情隱藏頁", () => {
    expect(
      inventoryModule.nodes.map((node) => [
        node.key,
        node.sidebarType,
        node.route,
        node.order,
      ]),
    ).toEqual([
      ["inventory", "link", "inventory", 20],
      ["inventory.book-page", "hidden", "book-page", 1],
    ]);
  });

  it("權限照 3.2 一次宣告全部;沒有 view / create / edit / delete", () => {
    expect(
      (inventoryModule.permissions ?? []).map((permission) => [
        permission.key,
        permission.moduleKey,
      ]),
    ).toEqual(
      Object.values(INVENTORY_PERMISSIONS).map((key) => [key, "inventory"]),
    );
    expect(Object.values(INVENTORY_PERMISSIONS)).toEqual([
      "inventory.mark-skipped",
      "inventory.recover",
      "inventory.scrap",
      "inventory.show-cost",
      "inventory.edit-allocations",
    ]);
  });

  it("登記進專案來源,與底座一起組裝不衝突", () => {
    expect(projectSeedSource.moduleDeclarations).toContain(inventoryModule);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });
});

describe("開通時建立的角色(規格 3.3):庫存管理那一段", () => {
  it("總部管理全部;店長不含 edit-allocations;店員不給", () => {
    const hq = roleGrantOf("hq", ROLE_GRANT_SECTIONS);
    expect(hq.moduleKeys).toEqual(
      expect.arrayContaining(["inventory", "inventory.book-page"]),
    );
    expect(hq.permissionKeys).toEqual(
      expect.arrayContaining(["inventory.*", "inventory.book-page.*"]),
    );
    const manager = roleGrantOf("store-manager", ROLE_GRANT_SECTIONS);
    expect(
      manager.permissionKeys.filter((key) => key.startsWith("inventory")),
    ).toEqual([
      "inventory.mark-skipped",
      "inventory.recover",
      "inventory.scrap",
      "inventory.show-cost",
    ]);
    const clerk = roleGrantOf("clerk", ROLE_GRANT_SECTIONS);
    expect(
      clerk.moduleKeys.filter((key) => key.startsWith("inventory")),
    ).toEqual([]);
  });
});
