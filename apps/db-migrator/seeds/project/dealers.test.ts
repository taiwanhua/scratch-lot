import { describe, expect, it } from "@jest/globals";

import { DEALERS_PERMISSIONS, dealersModule } from "./dealers";
import { demoPlan } from "./demo";
import { parseOnboardingPlan } from "./onboarding/plan";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { projectSeedSource } from "./registry";

describe("經銷商管理的模組宣告(專案規格 3.1、3.2)", () => {
  it("登記在專案種子來源", () => {
    expect(projectSeedSource.moduleDeclarations).toContain(dealersModule);
  });

  it("權限照 3.2:dealers 的 create / edit 與兩組欄位級權限、dealers.contacts 的 create / edit;沒有 view / delete", () => {
    expect(
      (dealersModule.permissions ?? []).map((permission) => permission.key),
    ).toEqual(Object.values(DEALERS_PERMISSIONS));
    expect(
      (dealersModule.permissions ?? []).some((permission) =>
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

describe("開通資料的乙類(開通清單第 6 點)", () => {
  const base = {
    branches: [{ name: "中山店" }],
    users: [],
    positions: [],
  };
  const dealer = {
    licenseNo: "12345678",
    name: "王大明",
    nationalId: "A123456789",
    licenseApprovedOn: "2025-01-02",
    licenseExpiresOn: "2027-12-31",
    storeName: "好運 2 號店",
    branch: "中山店",
  };

  it("合法的乙類照收;沒給就沒有這一欄", () => {
    expect(
      parseOnboardingPlan({ ...base, classBDealers: [dealer] }).classBDealers,
    ).toEqual([dealer]);
    expect(parseOnboardingPlan(base)).not.toHaveProperty("classBDealers");
  });

  it("對應分店不在 branches、證號不是 8 碼、日期格式不對 → 擋下", () => {
    expect(() =>
      parseOnboardingPlan({
        ...base,
        classBDealers: [{ ...dealer, branch: "信義店" }],
      }),
    ).toThrow("classBDealers[0].branch");
    expect(() =>
      parseOnboardingPlan({
        ...base,
        classBDealers: [{ ...dealer, licenseNo: "123" }],
      }),
    ).toThrow("classBDealers[0].licenseNo");
    expect(() =>
      parseOnboardingPlan({
        ...base,
        classBDealers: [{ ...dealer, licenseExpiresOn: "2027/12/31" }],
      }),
    ).toThrow("classBDealers[0].licenseExpiresOn");
  });

  it("示範資料:兩家乙類各對應一家示範分店", () => {
    const plan = demoPlan("owner@example.test");
    expect(
      (plan.classBDealers ?? []).map((item) => [item.storeName, item.branch]),
    ).toEqual([
      ["示範彩券 中山店", "中山店"],
      ["示範彩券 信義店", "信義店"],
    ]);
  });
});
