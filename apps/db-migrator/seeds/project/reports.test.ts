import { describe, expect, it } from "@jest/globals";

import { assembleSeedRegistry } from "../registry";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { projectSeedSource } from "./registry";
import { reportsModule } from "./reports";
import { projectSeedSettings } from "./settings";

describe("輸出報表的模組宣告(規格 3.1、3.2)", () => {
  it("一個側欄連結(固定頁),沒有隱藏頁", () => {
    expect(
      reportsModule.nodes.map((node) => [
        node.key,
        node.name,
        node.sidebarType,
        node.engine ?? "fixed",
      ]),
    ).toEqual([["reports", "輸出報表", "link", "fixed"]]);
  });

  it("權限照規格 3.2:兩張報表各一條 + 匯出 + 成本與毛利", () => {
    expect(
      (reportsModule.permissions ?? []).map((permission) => [
        permission.key,
        permission.moduleKey,
      ]),
    ).toEqual([
      ["reports.operations", "reports"],
      ["reports.shift-checkouts", "reports"],
      ["reports.export", "reports"],
      ["reports.show-cost", "reports"],
    ]);
  });

  it("登記進專案來源,與底座一起組裝不衝突", () => {
    expect(projectSeedSource.moduleDeclarations).toContain(reportsModule);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });

  it("開通時建立的角色(規格 3.3):總部管理、店長有輸出報表全部,店員沒有", () => {
    for (const role of ["hq", "store-manager"] as const) {
      const grant = roleGrantOf(role, ROLE_GRANT_SECTIONS);
      expect(grant.moduleKeys).toContain("reports");
      expect(grant.permissionKeys).toContain("reports.*");
    }
    const clerk = roleGrantOf("clerk", ROLE_GRANT_SECTIONS);
    expect(clerk.moduleKeys).not.toContain("reports");
    expect(
      clerk.permissionKeys.filter((key) => key.startsWith("reports.")),
    ).toEqual([]);
  });
});
