import { describe, expect, it } from "@jest/globals";

import { assembleSeedRegistry } from "../registry";
import { lotterySettingsModule } from "./lottery-settings";
import { masterDataModule } from "./master-data";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { projectSeedSource } from "./registry";
import { scheduleGroupModule } from "./schedule";
import { projectSeedSettings } from "./settings";

describe("刮刮樂設定的模組宣告(張數店規格第 4 節、5.7、12)", () => {
  it("側欄獨立一頁,排在檔案管理(70)之後、班表管理(80)之前", () => {
    const [node] = lotterySettingsModule.nodes;
    expect(lotterySettingsModule.nodes).toHaveLength(1);
    expect(node).toMatchObject({
      key: "lottery-settings",
      sidebarType: "link",
      parentKey: null,
      order: 75,
      route: "lottery-settings",
    });
    expect(masterDataModule.nodes[0]?.order).toBe(70);
    expect(scheduleGroupModule.nodes[0]?.order).toBe(80);
  });

  it("權限 view / edit-default / edit-org(分法同排班規則)", () => {
    expect(
      (lotterySettingsModule.permissions ?? []).map((permission) => [
        permission.key,
        permission.moduleKey,
      ]),
    ).toEqual([
      ["lottery-settings.view", "lottery-settings"],
      ["lottery-settings.edit-default", "lottery-settings"],
      ["lottery-settings.edit-org", "lottery-settings"],
    ]);
  });

  it("登記進專案來源,與底座一起組裝不衝突;wildcard 自動一筆", () => {
    expect(projectSeedSource.moduleDeclarations).toContain(
      lotterySettingsModule,
    );
    const registry = assembleSeedRegistry(
      projectSeedSettings,
      projectSeedSource,
    );
    const permissionKeys = registry
      .flatMap((set) =>
        set.kind === "documents" && set.collection === "permissions"
          ? set.entries.map((entry) => entry.key)
          : [],
      )
      .filter((key) => key.startsWith("lottery-settings."))
      .toSorted((left, right) => left.localeCompare(right));
    expect(permissionKeys).toEqual([
      "lottery-settings.*",
      "lottery-settings.edit-default",
      "lottery-settings.edit-org",
      "lottery-settings.view",
    ]);
  });

  it("開通時建立的角色:總部管理全部、店長只給 view、店員沒有", () => {
    const hq = roleGrantOf("hq", ROLE_GRANT_SECTIONS);
    expect(hq.moduleKeys).toContain("lottery-settings");
    expect(hq.permissionKeys).toContain("lottery-settings.*");

    const manager = roleGrantOf("store-manager", ROLE_GRANT_SECTIONS);
    expect(manager.moduleKeys).toContain("lottery-settings");
    expect(
      manager.permissionKeys.filter((key) =>
        key.startsWith("lottery-settings."),
      ),
    ).toEqual(["lottery-settings.view"]);

    const clerk = roleGrantOf("clerk", ROLE_GRANT_SECTIONS);
    expect(clerk.moduleKeys).not.toContain("lottery-settings");
    expect(
      clerk.permissionKeys.filter((key) => key.startsWith("lottery-settings.")),
    ).toEqual([]);
  });
});
