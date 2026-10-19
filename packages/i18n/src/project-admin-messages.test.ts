import { describe, expect, it } from "@jest/globals";

import { locales, messages } from ".";
import { composeAdminMessages } from "./project-admin-messages";

/**
 * 專案後台文案的合併規則(I18N-06):新增不撞底座、替換只換底座既有字串且參數名相同。
 * 違規一律載入就丟錯;正式的專案文案檔也照這套規則合併(最後一段)。
 */

const base = {
  login: {
    subtitle: "後台管理系統",
    footer: "© {year} {brand}",
  },
  app: { subtitle: "後台管理" },
};

const compose = (additions: object, replacements: object = {}) =>
  composeAdminMessages({ locale: "zh-TW", base, additions, replacements });

describe("composeAdminMessages", () => {
  it("沒有專案文案時回傳與底座相同的內容", () => {
    expect(compose({})).toEqual(base);
  });

  it("新增:可加新的頂層 namespace,也可往底座既有分支加底座沒有的鍵", () => {
    const result = compose({
      lotteryStore: { title: "門市", total: "共 {count} 張" },
      app: { tagline: "專案標語" },
    });
    expect(result).toEqual({
      ...base,
      app: { subtitle: "後台管理", tagline: "專案標語" },
      lotteryStore: { title: "門市", total: "共 {count} 張" },
    });
  });

  it("新增:與底座同一路徑的字串或分支都算撞 key", () => {
    expect(() => compose({ app: { subtitle: "改掉" } })).toThrow(
      /zh-TW.*admin\.app\.subtitle 與底座撞 key/,
    );
    expect(() => compose({ login: "整個換掉" })).toThrow(
      /admin\.login 與底座撞 key/,
    );
    expect(() => compose({ app: { subtitle: { nested: "x" } } })).toThrow(
      /admin\.app\.subtitle 與底座撞 key/,
    );
  });

  it("新增:值只能是字串或物件", () => {
    expect(() => compose({ count: 3 })).toThrow(
      /admin\.count 必須是字串或物件/,
    );
  });

  it("替換:換掉底座既有字串,參數名相同才接受", () => {
    const result = compose(
      {},
      {
        login: { subtitle: "門市後台", footer: "{brand} © {year}" },
      },
    );
    expect(result.login).toEqual({
      subtitle: "門市後台",
      footer: "{brand} © {year}",
    });
  });

  it("替換:參數名與底座不同就丟錯(少了、多了或改名)", () => {
    expect(() => compose({}, { login: { footer: "© {year}" } })).toThrow(
      /admin\.login\.footer 參數名與底座不同.底座:brand, year;替換:year./,
    );
    expect(() => compose({}, { app: { subtitle: "{name} 後台" } })).toThrow(
      /admin\.app\.subtitle 參數名與底座不同.底座:無;替換:name./,
    );
  });

  it("替換:底座沒有的鍵、分支或專案新增的鍵都不能替換", () => {
    expect(() => compose({}, { app: { tagline: "x" } })).toThrow(
      /替換的 admin\.app\.tagline 不在底座字典裡/,
    );
    expect(() => compose({}, { login: "整個換掉" })).toThrow(
      /替換的 admin.login 必須是物件/,
    );
    expect(() =>
      compose({ extra: { a: "新增" } }, { extra: { a: "替換" } }),
    ).toThrow(/替換的 admin\.extra 不在底座字典裡/);
    expect(() => compose({}, { app: { subtitle: 1 } })).toThrow(
      /替換的 admin\.app\.subtitle 必須是字串/,
    );
  });

  it("不修改傳入的底座字典", () => {
    const before = JSON.stringify(base);
    compose({ app: { tagline: "x" } }, { login: { subtitle: "y" } });
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("正式字典已併入專案後台文案", () => {
  it.each(locales)("%s 的 admin 字典載入時通過合併規則", (locale) => {
    expect(messages[locale].admin.login.subtitle).toEqual(expect.any(String));
  });
});
