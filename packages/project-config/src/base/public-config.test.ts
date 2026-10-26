import { describe, expect, it } from "@jest/globals";

import {
  type ProjectPublicConfig,
  assertProjectPublicConfig,
} from "./public-config";

/** 替代品牌夾具:每個欄位都與 CookHome 不同,驗證檢查器不認特定專案。 */
const ALTERNATIVE: ProjectPublicConfig = {
  slug: "acme-portal",
  brand: { name: "Acme Portal", primary: "#2065D1" },
  admin: {
    documentTitle: "Acme <Admin> & Co",
    webApp: {
      name: "Acme <Portal> & Co",
      shortName: "Acme",
      themeColor: "#0B3D91",
      backgroundColor: "#F4F6F8",
    },
  },
  front: {
    metadata: {
      "zh-TW": {
        title: "Acme — 入口",
        titleTemplate: "%s | Acme",
        description: "Acme 的網站",
      },
      en: {
        title: "Acme — Portal",
        titleTemplate: "%s | Acme",
        description: "The Acme site",
      },
    },
  },
  compatibility: { legacySideNavStorageKey: null },
};

/** 以不合型別的輸入模擬「專案值被改壞」;檢查器在執行期把關,所以夾具的型別刻意放寬。 */
const broken = (patch: Record<string, unknown>): ProjectPublicConfig =>
  Object.assign({}, ALTERNATIVE, patch);

describe("公開設定的驗證(不默默補回任何專案的值)", () => {
  it("合法設定原樣回傳,不改寫內容", () => {
    expect(assertProjectPublicConfig(ALTERNATIVE)).toBe(ALTERNATIVE);
  });

  it.each(["", "Acme", "acme_portal", "acme portal", "-acme", "acme-", "a--b"])(
    "slug %p 不是小寫 kebab-case → 拒絕",
    (slug) => {
      expect(() => assertProjectPublicConfig(broken({ slug }))).toThrow(/slug/);
    },
  );

  it.each(["FB7B10", "#FB7B1", "#FB7B10FF", "#GGGGGG", "orange", ""])(
    "primary %p 不是 # 加六位十六進位 → 拒絕",
    (primary) => {
      expect(() =>
        assertProjectPublicConfig(broken({ brand: { name: "Acme", primary } })),
      ).toThrow(/brand\.primary/);
    },
  );

  it("缺少必要值時指出是哪一個欄位", () => {
    expect(() =>
      assertProjectPublicConfig(
        broken({ brand: { name: " ", primary: "#2065D1" } }),
      ),
    ).toThrow(/brand\.name/);
    expect(() =>
      assertProjectPublicConfig(
        broken({ admin: { documentTitle: "", webApp: null } }),
      ),
    ).toThrow(/admin\.documentTitle/);
    expect(() =>
      assertProjectPublicConfig(broken({ slug: undefined })),
    ).toThrow(/slug/);
    expect(() =>
      assertProjectPublicConfig(broken({ front: { metadata: {} } })),
    ).toThrow(/front\.metadata/);
    expect(() =>
      assertProjectPublicConfig(
        broken({
          front: {
            metadata: {
              "zh-TW": { title: "Acme", titleTemplate: "%s | Acme" },
            },
          },
        }),
      ),
    ).toThrow(/front\.metadata\.zh-TW\.description/);
  });

  it("titleTemplate 必須保留 `%s` 佔位(Next 的 title template 語意)", () => {
    expect(() =>
      assertProjectPublicConfig(
        broken({
          front: {
            metadata: {
              en: { title: "Acme", titleTemplate: "Acme", description: "x" },
            },
          },
        }),
      ),
    ).toThrow(/front\.metadata\.en\.titleTemplate/);
  });

  it("webApp 可為 null(不提供 manifest)", () => {
    const withoutWebApp = broken({
      admin: { documentTitle: "Acme", webApp: null },
    });

    expect(assertProjectPublicConfig(withoutWebApp)).toBe(withoutWebApp);
  });

  it("webApp 缺欄或色碼不對時指出是哪一個欄位", () => {
    const webApp = ALTERNATIVE.admin.webApp;
    const withWebApp = (patch: Record<string, unknown>) =>
      broken({
        admin: { documentTitle: "Acme", webApp: { ...webApp, ...patch } },
      });

    expect(() =>
      assertProjectPublicConfig(broken({ admin: { documentTitle: "Acme" } })),
    ).toThrow(/admin\.webApp/);
    expect(() => assertProjectPublicConfig(withWebApp({ name: " " }))).toThrow(
      /admin\.webApp\.name/,
    );
    expect(() =>
      assertProjectPublicConfig(withWebApp({ shortName: undefined })),
    ).toThrow(/admin\.webApp\.shortName/);
    expect(() =>
      assertProjectPublicConfig(withWebApp({ themeColor: "navy" })),
    ).toThrow(/admin\.webApp\.themeColor/);
    expect(() =>
      assertProjectPublicConfig(withWebApp({ backgroundColor: "#FFF" })),
    ).toThrow(/admin\.webApp\.backgroundColor/);
  });

  it("legacySideNavStorageKey 只接受 null 或非空字串", () => {
    expect(() =>
      assertProjectPublicConfig(
        broken({ compatibility: { legacySideNavStorageKey: "" } }),
      ),
    ).toThrow(/compatibility\.legacySideNavStorageKey/);
    expect(() =>
      assertProjectPublicConfig(broken({ compatibility: {} })),
    ).toThrow(/compatibility\.legacySideNavStorageKey/);
  });
});
