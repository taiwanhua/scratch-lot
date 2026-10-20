import { describe, expect, it } from "@jest/globals";

import { DEALERS_PERMISSIONS, dealersModule } from "./dealers";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { projectSeedSource } from "./registry";

describe("經銷商管理的模組宣告(專案規格 3.1、3.2)", () => {
  it("登記在專案種子來源", () => {
    expect(projectSeedSource.moduleDeclarations).toContain(dealersModule);
  });

  it("權限照 3.2:dealers 的 create / edit 與兩組欄位級權限、dealers.contacts 的 create / edit;沒有 view / delete", () => {
    expect(
      dealersModule.permissions.map((permission) => permission.key),
    ).toEqual(Object.values(DEALERS_PERMISSIONS));
    expect(
      dealersModule.permissions.some((permission) =>
        /\.(view|delete)$/.test(permission.key),
      ),
    ).toBe(false);
  });

  it("隱藏頁的 key 以 -page 結尾;關係人是權限容器(沒有路由)", () => {
    const contacts = dealersModule.nodes.find(
      (node) => node.key === "dealers.contacts",
    );
    expect(contacts?.route).toBeUndefined();
    for (const node of dealersModule.nodes.filter(
      (item) =>
        item.sidebarType === "hidden" && item.key !== "dealers.contacts",
    )) {
      expect(node.key).toMatch(/-page$/);
    }
  });
});

describe("開通時建立的角色(規格 3.3):經銷商管理那一段", () => {
  it("總部管理全部;店長只看得到(不含主檔修改);店員不給", () => {
    expect(roleGrantOf("hq", ROLE_GRANT_SECTIONS).permissionKeys).toEqual(
      expect.arrayContaining(["dealers.*", "dealers.contacts.*"]),
    );
    const manager = roleGrantOf("store-manager", ROLE_GRANT_SECTIONS);
    expect(manager.moduleKeys).toEqual(
      expect.arrayContaining(["dealers", "dealers.view-page"]),
    );
    expect(
      manager.permissionKeys.filter((key) => key.startsWith("dealers")),
    ).toEqual([]);
    expect(
      roleGrantOf("clerk", ROLE_GRANT_SECTIONS).moduleKeys.filter((key) =>
        key.startsWith("dealers"),
      ),
    ).toEqual([]);
  });
});
