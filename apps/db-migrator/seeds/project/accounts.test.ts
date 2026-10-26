import { describe, expect, it } from "@jest/globals";

import { ACCOUNTS_PERMISSIONS } from "@repo/domain/project/lottery-accounts";

import { assembleSeedRegistry } from "../registry";
import { accountsModule } from "./accounts";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { projectSeedSource } from "./registry";
import { projectSeedSettings } from "./settings";

describe("帳戶管理的模組宣告(規格 3.1、3.2)", () => {
  it("一個側欄連結(order 40)+ 銀行帳戶詳情隱藏頁", () => {
    expect(
      accountsModule.nodes.map((node) => [
        node.key,
        node.sidebarType,
        node.route,
        node.order,
      ]),
    ).toEqual([
      ["accounts", "link", "accounts", 40],
      ["accounts.view-page", "hidden", "view-page", 1],
    ]);
  });

  it("權限照 3.2 一次宣告全部(含關帳);沒有 view / create / edit / delete", () => {
    expect(
      (accountsModule.permissions ?? []).map((permission) => [
        permission.key,
        permission.moduleKey,
      ]),
    ).toEqual(
      Object.values(ACCOUNTS_PERMISSIONS).map((key) => [key, "accounts"]),
    );
    expect(Object.values(ACCOUNTS_PERMISSIONS)).toEqual([
      "accounts.view-bank-accounts",
      "accounts.create-bank-account",
      "accounts.edit-bank-account",
      "accounts.record-bank-transaction",
      "accounts.reverse-bank-transaction",
      "accounts.view-cash",
      "accounts.view-outstanding",
      "accounts.close-period",
    ]);
  });

  it("登記進專案來源,與底座一起組裝不衝突", () => {
    expect(projectSeedSource.moduleDeclarations).toContain(accountsModule);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });
});

describe("開通時建立的角色(規格 3.3):帳戶管理那一段", () => {
  it("總部管理全部;店長銀行帳戶(只看)+ 即時現金帳 + 待結清款項,不含新增 / 編輯 / 登記交易 / 沖正 / 關帳;店員不給", () => {
    const hq = roleGrantOf("hq", ROLE_GRANT_SECTIONS);
    expect(hq.moduleKeys).toEqual(
      expect.arrayContaining(["accounts", "accounts.view-page"]),
    );
    expect(hq.permissionKeys).toEqual(
      expect.arrayContaining(["accounts.*", "accounts.view-page.*"]),
    );
    const manager = roleGrantOf("store-manager", ROLE_GRANT_SECTIONS);
    expect(
      manager.permissionKeys.filter((key) => key.startsWith("accounts")),
    ).toEqual([
      "accounts.view-bank-accounts",
      "accounts.view-cash",
      "accounts.view-outstanding",
    ]);
    // 帳戶詳情只給模組,不給 `accounts.view-page.*`
    expect(
      manager.moduleKeys.filter((key) => key.startsWith("accounts")),
    ).toEqual(["accounts", "accounts.view-page"]);
    const clerk = roleGrantOf("clerk", ROLE_GRANT_SECTIONS);
    expect(
      clerk.moduleKeys.filter((key) => key.startsWith("accounts")),
    ).toEqual([]);
  });
});
