import { describe, expect, it } from "@jest/globals";

import { projectMail } from "./mail";
import {
  type ProjectPublicConfig,
  createAdminStorageKeys,
  projectPublic,
} from "./public";

/** 以契約的型別讀舊鍵:目前專案的值可能是字串也可能是 null,兩種都要成立。 */
const legacySideNavKeyOf = (config: ProjectPublicConfig): string | null =>
  config.compatibility.legacySideNavStorageKey;

/**
 * 目前專案值(`src/project/`)的通用契約。這裡不寫任何專案的字面值:
 * 新專案只換 `project/public.ts` 與 `project/mail.ts`,本檔不必跟著改。
 * 特定專案的歷史值(舊資料相容)以固定夾具驗,見 `base/cookhome-legacy.test.ts`。
 */
describe("目前的專案設定符合公開契約", () => {
  it("slug 是小寫 kebab-case", () => {
    expect(projectPublic.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("七把 admin 儲存鍵都以目前的 slug 開頭,用途後綴固定", () => {
    const { slug } = projectPublic;

    expect(createAdminStorageKeys(slug)).toEqual({
      locale: `${slug}-admin-locale`,
      colorMode: `${slug}-admin-color-mode`,
      colorScheme: `${slug}-admin-color-scheme`,
      routeTabsPrefix: `${slug}-admin-route-tabs`,
      sessionChannel: `${slug}-admin-session`,
      sideNav: `${slug}-admin-sidenav`,
      sectionsPrefix: `${slug}-admin-sections`,
    });
  });

  it("側欄舊鍵是 null,或一把與新鍵不同的非空字串", () => {
    const legacy = legacySideNavKeyOf(projectPublic);

    expect(
      legacy === null ||
        (legacy.trim() !== "" &&
          legacy !== createAdminStorageKeys(projectPublic.slug).sideNav),
    ).toBe(true);
  });

  it("品牌名非空,主色是 # 加六位十六進位", () => {
    expect(projectPublic.brand.name.trim()).not.toBe("");
    expect(projectPublic.brand.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(projectPublic.admin.documentTitle.trim()).not.toBe("");
  });

  it("可安裝 app 的設定是 null,或名稱非空、顏色是 # 加六位十六進位", () => {
    const { webApp } = projectPublic.admin as ProjectPublicConfig["admin"];

    expect(
      webApp === null ||
        (webApp.name.trim() !== "" &&
          webApp.shortName.trim() !== "" &&
          /^#[0-9A-Fa-f]{6}$/.test(webApp.themeColor) &&
          /^#[0-9A-Fa-f]{6}$/.test(webApp.backgroundColor)),
    ).toBe(true);
  });

  it("每個語系的前台 metadata 三欄非空,title template 保留 `%s`", () => {
    const entries = Object.entries(projectPublic.front.metadata);

    expect(entries.length).toBeGreaterThan(0);
    for (const [locale, meta] of entries) {
      expect({ locale, blank: meta.title.trim() === "" }).toEqual({
        locale,
        blank: false,
      });
      expect({ locale, blank: meta.description.trim() === "" }).toEqual({
        locale,
        blank: false,
      });
      expect({ locale, template: meta.titleTemplate }).toEqual({
        locale,
        template: expect.stringContaining("%s"),
      });
    }
  });

  it("信件設定:品牌名引用公開設定,寄件信箱是單純的信箱,署名非空", () => {
    expect(projectMail.brandName).toBe(projectPublic.brand.name);
    expect(projectMail.senderEmail).toMatch(/^[^\s<>@]+@[^\s<>@]+$/);
    expect(projectMail.signature.trim()).not.toBe("");
  });
});
