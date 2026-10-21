import { describe, expect, it } from "@jest/globals";

import { assembleSeedRegistry } from "../registry";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { projectSeedSource } from "./registry";
import { projectSeedSettings } from "./settings";
import { storeModule } from "./store";

describe("店面管理的模組宣告(規格 3.1、3.2)", () => {
  it("頂層表單模組(側欄 order 10)、開啟 B9b + 三個隱藏頁", () => {
    expect(
      storeModule.nodes.map((node) => [
        node.key,
        node.sidebarType,
        node.engine ?? "fixed",
        node.parentKey,
      ]),
    ).toEqual([
      ["store", "link", "form", null],
      ["store.view-page", "hidden", "fixed", "store"],
      ["store.create-page", "hidden", "fixed", "store"],
      ["store.edit-page", "hidden", "fixed", "store"],
    ]);
    expect(storeModule.nodes[0]).toMatchObject({
      order: 10,
      perFormCreate: true,
    });
  });

  it("權限照規格 3.2:表單四條 + 14 個頁內權限", () => {
    expect(
      (storeModule.permissions ?? []).map((permission) => permission.key),
    ).toEqual([
      "store.view",
      "store.create",
      "store.edit",
      "store.delete",
      "store.sell",
      "store.undo-sale",
      "store.split",
      "store.move",
      "store.redeem",
      "store.undo-redeem",
      "store.open-shift",
      "store.deposit",
      "store.withdraw",
      "store.bank-deposit",
      "store.stocktake",
      "store.checkout",
      "store.skip-stocktake",
      "store.confirm-lost",
    ]);
  });

  it("登記進專案來源,與底座一起組裝不衝突", () => {
    expect(projectSeedSource.moduleDeclarations).toContain(storeModule);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });
});

describe("開通時建立的角色(規格 3.3)", () => {
  it("總部管理、店長:店面管理全部(含存銀行)", () => {
    for (const role of ["hq", "store-manager"] as const) {
      expect(roleGrantOf(role, ROLE_GRANT_SECTIONS).permissionKeys).toContain(
        "store.*",
      );
    }
  });

  it("店員:看板與第一線動作,不含存銀行、撤銷兌獎、跳過盤點、確認遺失", () => {
    const clerk = roleGrantOf("clerk", ROLE_GRANT_SECTIONS).permissionKeys;
    expect(clerk).toEqual(
      expect.arrayContaining([
        "store.view",
        "store.sell",
        "store.undo-sale",
        "store.split",
        "store.move",
        "store.redeem",
        "store.open-shift",
        "store.deposit",
        "store.withdraw",
        "store.stocktake",
        "store.checkout",
      ]),
    );
    for (const key of [
      "store.*",
      "store.bank-deposit",
      "store.undo-redeem",
      "store.skip-stocktake",
      "store.confirm-lost",
    ]) {
      expect(clerk).not.toContain(key);
    }
  });
});
