import { describe, expect, it } from "@jest/globals";

import { baseModuleDeclarations } from "../base/modules";
import { reportsModule as baseReportsModule } from "../base/modules/reports";
import { assembleSeedRegistry } from "../registry";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { projectSeedSource } from "./registry";
import { reportsModule } from "./reports";
import { projectSeedSettings } from "./settings";

describe("輸出報表的專案報表權限(規格 3.1、3.2)", () => {
  it("模組本身是底座的:專案不宣告模組節點", () => {
    expect(reportsModule.nodes).toEqual([]);
    expect(baseModuleDeclarations).toContain(baseReportsModule);
  });

  it("權限照規格 3.2:兩張報表各一條(匯出、成本與毛利是底座的模組層權限)", () => {
    expect(
      (reportsModule.permissions ?? []).map((permission) => [
        permission.key,
        permission.moduleKey,
      ]),
    ).toEqual([
      ["reports.operations", "reports"],
      ["reports.shift-checkouts", "reports"],
    ]);
    expect(
      (baseReportsModule.permissions ?? []).map((permission) => permission.key),
    ).toEqual(["reports.export", "reports.show-cost"]);
  });

  it("登記進專案來源,與底座一起組裝不衝突", () => {
    expect(projectSeedSource.moduleDeclarations).toContain(reportsModule);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });

  it("模組改由底座宣告後,合成的 key 與搬移前相同:一個 reports 模組、四條個別權限 + wildcard,各一筆", () => {
    const registry = assembleSeedRegistry(
      projectSeedSettings,
      projectSeedSource,
    );
    const keysOf = (collection: string) =>
      registry.flatMap((set) =>
        set.kind === "documents" && set.collection === collection
          ? set.entries.map((entry) => entry.key)
          : [],
      );
    expect(keysOf("modules").filter((key) => key === "reports")).toEqual([
      "reports",
    ]);
    expect(
      keysOf("permissions")
        .filter((key) => key.startsWith("reports."))
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual([
      "reports.*",
      "reports.export",
      "reports.operations",
      "reports.shift-checkouts",
      "reports.show-cost",
    ]);
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
