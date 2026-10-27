import { describe, expect, it } from "@jest/globals";

import { assembleSeedRegistry } from "../registry";
import { projectSeedSource } from "./registry";
import { scheduleModuleDeclarations } from "./schedule";
import { projectSeedSettings } from "./settings";

/** 規格 3.2 的權限表(個別權限;每個節點的 wildcard 由組裝自動產生,不在這裡)。 */
const EXPECTED_PERMISSIONS: Record<string, string[]> = {
  "schedule.my": ["view", "punch", "edit-day-offs"],
  "schedule.manage": [
    "view",
    "create",
    "edit",
    "delete",
    "auto-run",
    "publish",
    "view-day-offs",
    "use-punch-time",
    "edit-day-offs",
    "edit-calendar",
  ],
  "schedule.settings": [
    "view",
    "edit-templates",
    "edit-staff",
    "edit-default-rules",
    "edit-org-rules",
  ],
  "schedule.attendance": [
    "view",
    "create",
    "edit",
    "delete",
    "view-all",
    "export",
    "reassign-punches",
  ],
};

function permissionsByModule(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const declaration of scheduleModuleDeclarations) {
    for (const permission of declaration.permissions ?? []) {
      const action = permission.key.slice(permission.moduleKey.length + 1);
      result[permission.moduleKey] = [
        ...(result[permission.moduleKey] ?? []),
        action,
      ];
    }
  }
  return result;
}

describe("班表管理的模組宣告(規格 3.1、3.2)", () => {
  it("群組 + 四個子模組;排班作業、出勤紀錄是表單模組", () => {
    const nodes = scheduleModuleDeclarations.flatMap(
      (declaration) => declaration.nodes,
    );
    const visible = nodes.filter((node) => node.sidebarType !== "hidden");
    expect(
      visible.map((node) => [node.key, node.name, node.engine ?? "fixed"]),
    ).toEqual([
      ["schedule", "班表管理", "fixed"],
      ["schedule.my", "我的班表", "fixed"],
      ["schedule.manage", "排班作業", "form"],
      ["schedule.settings", "排班設定", "fixed"],
      ["schedule.attendance", "出勤紀錄", "form"],
    ]);
  });

  it("權限照規格 3.2 全部宣告", () => {
    expect(permissionsByModule()).toEqual(EXPECTED_PERMISSIONS);
  });

  it("登記進專案來源,與底座一起組裝不衝突", () => {
    expect(projectSeedSource.moduleDeclarations).toEqual(
      expect.arrayContaining([...scheduleModuleDeclarations]),
    );
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });
});
