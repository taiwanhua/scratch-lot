import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import { type Messages, messages } from "./base-messages";
import { type Locale, defaultLocale, locales } from "./locales";
import { flattenKeys, icuArgumentsOf, leafValuesOf } from "./message-keys";
import {
  type ProjectMessageValues,
  composeProjectMessages,
} from "./project-messages";

/** 替代品牌夾具:四個鍵都與基礎字典、與任何既有專案不同。 */
const ALTERNATIVE: ProjectMessageValues = {
  brandName: "Acme Portal",
  frontMetadata: {
    "zh-TW": {
      title: "Acme — 入口",
      titleTemplate: "%s | Acme",
      description: "Acme 的網站",
    },
    en: {
      title: "Acme — Portal",
      titleTemplate: "%s · Acme",
      description: "The Acme site",
    },
  },
};

/** 專案值接管的四個鍵;其餘鍵一律原樣沿用基礎字典。 */
const PROJECT_KEYS = [
  "common.brand",
  "front.meta.title",
  "front.meta.titleTemplate",
  "front.meta.description",
];

const SRC_DIR = __dirname;

describe("composeProjectMessages:專案品牌注入字典", () => {
  const composed = composeProjectMessages(ALTERNATIVE);

  it("回傳的語系就是 `locales` 宣告的那幾個", () => {
    expect(
      Object.keys(composed).toSorted((a, b) => a.localeCompare(b, "zh-Hant")),
    ).toEqual([...locales].toSorted((a, b) => a.localeCompare(b, "zh-Hant")));
  });

  it.each(locales)("%s:只覆寫品牌名與 front.meta 三個鍵", (locale) => {
    expect(composed[locale].common.brand).toBe("Acme Portal");
    expect(composed[locale].front.meta).toEqual(
      ALTERNATIVE.frontMetadata[locale],
    );

    const base = leafValuesOf(messages[locale]);
    const next = leafValuesOf(composed[locale]);
    expect([...next.keys()]).toEqual([...base.keys()]);
    const changed = [...next.keys()].filter(
      (key) => next.get(key) !== base.get(key),
    );
    expect(changed).toEqual(PROJECT_KEYS);
  });

  it("title template 的 `%s` 原樣保留,不當 ICU 變數替換", () => {
    expect(composed["zh-TW"].front.meta.titleTemplate).toBe("%s | Acme");
    expect(composed.en.front.meta.titleTemplate).toBe("%s · Acme");
  });

  it.each(locales)("%s:注入後每個鍵的 ICU 參數與基礎字典相同", (locale) => {
    const base = leafValuesOf(messages[locale]);
    const mismatched = [...leafValuesOf(composed[locale])].filter(
      ([key, value]) =>
        icuArgumentsOf(value).join(",") !==
        icuArgumentsOf(base.get(key) ?? "").join(","),
    );
    expect(mismatched).toEqual([]);
  });

  it("注入後各語系同一個鍵的 ICU 參數一致(換語言不會少帶或多帶變數)", () => {
    const reference = leafValuesOf(composed[defaultLocale]);
    for (const locale of locales) {
      const mismatched = [...leafValuesOf(composed[locale])]
        .filter(
          ([key, value]) =>
            icuArgumentsOf(value).join(",") !==
            icuArgumentsOf(reference.get(key) ?? "").join(","),
        )
        .map(([key]) => key);
      expect({ locale, mismatched }).toEqual({ locale, mismatched: [] });
    }
  });

  it("注入後各語系的鍵集合仍完全一致", () => {
    const reference = flattenKeys(composed[defaultLocale], "root");
    for (const locale of locales) {
      const other = flattenKeys(composed[locale], "root");
      expect({
        locale,
        missing: [...reference.leaves].filter((key) => !other.leaves.has(key)),
        extra: [...other.leaves].filter((key) => !reference.leaves.has(key)),
      }).toEqual({ locale, missing: [], extra: [] });
    }
  });

  it("不修改基礎字典:基礎物件內容不變,回傳的是新物件", () => {
    const before = JSON.stringify(messages);

    const result = composeProjectMessages(ALTERNATIVE);

    expect(JSON.stringify(messages)).toBe(before);
    for (const locale of locales) {
      expect(result[locale]).not.toBe(messages[locale]);
      expect(result[locale].common).not.toBe(messages[locale].common);
      expect(result[locale].front).not.toBe(messages[locale].front);
      expect(result[locale].front.meta).not.toBe(messages[locale].front.meta);
      // 沒被覆寫的 namespace 直接沿用同一份(不做通用 deep merge / 複製)
      expect(result[locale].admin).toBe(messages[locale].admin);
      expect(result[locale].front.home).toBe(messages[locale].front.home);
    }
  });

  it("不保留輸入物件的參考:之後改輸入不會改到組裝結果", () => {
    const values: ProjectMessageValues = structuredClone(ALTERNATIVE);
    const result = composeProjectMessages(values);

    values.frontMetadata.en.title = "changed";

    expect(result.en.front.meta.title).toBe("Acme — Portal");
  });

  it("缺語系時丟出指名語系的錯誤,不退回基礎字典的值", () => {
    const partial: Partial<Record<Locale, Messages["front"]["meta"]>> = {
      "zh-TW": ALTERNATIVE.frontMetadata["zh-TW"],
    };

    expect(() =>
      composeProjectMessages({
        brandName: "Acme Portal",
        frontMetadata: partial as Record<Locale, Messages["front"]["meta"]>,
      }),
    ).toThrow(/缺少語系 en/);
  });

  it("品牌名或 metadata 欄位空白時明確失敗", () => {
    expect(() =>
      composeProjectMessages({ ...ALTERNATIVE, brandName: " " }),
    ).toThrow(/brandName/);
    expect(() =>
      composeProjectMessages({
        ...ALTERNATIVE,
        frontMetadata: {
          ...ALTERNATIVE.frontMetadata,
          en: { ...ALTERNATIVE.frontMetadata.en, description: "" },
        },
      }),
    ).toThrow(/en.*description/);
  });
});

/**
 * 抽專案設定前,字典裡這四個鍵的原文(固定夾具,不讀任何專案設定)。
 * 以它為輸入組出來的字典必須與原字典逐字相同 —— 既有專案的顯示不因抽設定而變。
 */
const COOKHOME_LEGACY: ProjectMessageValues = {
  brandName: "CookHome",
  frontMetadata: {
    "zh-TW": {
      title: "CookHome — 家常食譜",
      titleTemplate: "%s | CookHome",
      description: "分享與收藏家常食譜的網站",
    },
    en: {
      title: "CookHome — Home-style Recipes",
      titleTemplate: "%s | CookHome",
      description: "Share and collect home-style recipes",
    },
  },
};

describe("固定的 CookHome 夾具:注入結果與抽設定前的字典逐字相同", () => {
  const composed = composeProjectMessages(COOKHOME_LEGACY);

  it("zh-TW", () => {
    expect(composed["zh-TW"].common).toEqual({ brand: "CookHome" });
    expect(composed["zh-TW"].front.meta).toEqual({
      title: "CookHome — 家常食譜",
      titleTemplate: "%s | CookHome",
      description: "分享與收藏家常食譜的網站",
    });
  });

  it("en", () => {
    expect(composed.en.common).toEqual({ brand: "CookHome" });
    expect(composed.en.front.meta).toEqual({
      title: "CookHome — Home-style Recipes",
      titleTemplate: "%s | CookHome",
      description: "Share and collect home-style recipes",
    });
  });
});

/**
 * 專案值是純文字,字典卻是 ICU 訊息:`{`、`<`、`'` 不編碼就會被當成參數、標籤或引號。
 * 左欄是專案提供的原文,右欄是寫進字典的 ICU 訊息(期望值逐筆手寫,不經受測函式推導);
 * 「翻譯函式實際顯示原文、不報錯」由 admin 的消費端測試以真的 use-intl 驗。
 */
const ICU_LITERAL_CASES: readonly (readonly [string, string])[] = [
  ["Acme Portal", "Acme Portal"],
  ["Acme {name}", "Acme '{name}'"],
  ["Acme {", "Acme '{'"],
  ["Acme <x>", "Acme '<x>'"],
  ["Acme <x>Portal</x>", "Acme '<x>Portal</x>'"],
  ["O'Brien", "O''Brien"],
  ["Acme '{name}'", "Acme '''{name}'''"],
  ["{}'{}", "'{}''{}'"],
  ["a } > # b", "a } > # b"],
];

describe("專案純文字以 ICU literal 寫進字典", () => {
  it.each(ICU_LITERAL_CASES)("品牌名 %p → 字典 %p", (text, encoded) => {
    const composed = composeProjectMessages({
      ...ALTERNATIVE,
      brandName: text,
    });

    for (const locale of locales) {
      expect(composed[locale].common.brand).toBe(encoded);
    }
  });

  it.each(ICU_LITERAL_CASES)(
    "metadata 三欄 %p → 字典 %p;titleTemplate 的 `%%s` 留在引號外",
    (text, encoded) => {
      const meta = {
        title: text,
        titleTemplate: `%s | ${text}`,
        description: text,
      };
      const composed = composeProjectMessages({
        brandName: "Acme Portal",
        frontMetadata: { "zh-TW": meta, en: meta },
      });

      for (const locale of locales) {
        expect(composed[locale].front.meta).toEqual({
          title: encoded,
          titleTemplate: `%s | ${encoded}`,
          description: encoded,
        });
      }
    },
  );

  it.each(ICU_LITERAL_CASES)(
    "注入 %p 後四個鍵仍不帶 ICU 參數,其餘鍵的參數不變",
    (text) => {
      const meta = {
        title: text,
        titleTemplate: `%s | ${text}`,
        description: text,
      };
      const composed = composeProjectMessages({
        brandName: text,
        frontMetadata: { "zh-TW": meta, en: meta },
      });

      for (const locale of locales) {
        const base = leafValuesOf(messages[locale]);
        const mismatched = [...leafValuesOf(composed[locale])]
          .filter(
            ([key, value]) =>
              icuArgumentsOf(value).join(",") !==
              icuArgumentsOf(base.get(key) ?? "").join(","),
          )
          .map(([key]) => key);
        expect({ locale, mismatched }).toEqual({ locale, mismatched: [] });
      }
    },
  );
});

describe("基礎字典是中性預設", () => {
  it.each(locales)("%s:專案接管的四個鍵不含任何專案的品牌字樣", (locale) => {
    const base = leafValuesOf(messages[locale]);
    for (const key of PROJECT_KEYS) {
      expect({ key, value: base.get(key) }).not.toEqual({
        key,
        value: expect.stringMatching(/cookhome/i),
      });
      expect(base.get(key)).toEqual(expect.any(String));
    }
  });

  it.each(locales)("%s:四個鍵本身不帶 ICU 參數(覆寫不會吃掉參數)", (locale) => {
    const base = leafValuesOf(messages[locale]);
    for (const key of PROJECT_KEYS) {
      expect({ key, args: icuArgumentsOf(base.get(key) ?? "") }).toEqual({
        key,
        args: [],
      });
    }
  });
});

describe("icuArgumentsOf(測試工具本身)", () => {
  it("plural 分支裡 `'#` 開啟引號:引號內的 `{…}` 不是參數", () => {
    expect(
      icuArgumentsOf("{count, plural, one {'# {notArg}'} other {{real}}}"),
    ).toEqual(["count", "real"]);
    // select 分支與最外層的 `'#` 不開引號,後面的 `{…}` 仍是參數
    expect(
      icuArgumentsOf("{kind, select, a {'# {inSelect}'} other {x}}"),
    ).toEqual(["inSelect", "kind"]);
    expect(icuArgumentsOf("'# {top}'")).toEqual(["top"]);
  });

  it("最外層落單的 `}` 是文字,後面的參數照算", () => {
    expect(icuArgumentsOf("} before {real}")).toEqual(["real"]);
    expect(icuArgumentsOf("a } b } {x} } {y}")).toEqual(["x", "y"]);
  });

  it("取出最外層與巢狀分支裡的參數名,略過分支文字與 `#`", () => {
    expect(icuArgumentsOf("共 {count} 道食譜")).toEqual(["count"]);
    expect(
      icuArgumentsOf(
        "{count, plural, one {# item for {name}} other {items}} by {owner}",
      ),
    ).toEqual(["count", "name", "owner"]);
    expect(icuArgumentsOf("%s | Acme")).toEqual([]);
  });

  it("單引號跳脫:引號內的 `{…}` 是文字不是參數,`''` 是一個單引號", () => {
    expect(icuArgumentsOf("'{name}' {real}")).toEqual(["real"]);
    expect(icuArgumentsOf("It''s {a}")).toEqual(["a"]);
    expect(icuArgumentsOf("O'Brien {a}")).toEqual(["a"]);
    expect(icuArgumentsOf("'{it''s {x}}' {b}")).toEqual(["b"]);
    expect(icuArgumentsOf("'<b>{x}</b>'")).toEqual([]);
    // 沒收尾的引號一路吃到結尾(與 ICU 解析器相同)
    expect(icuArgumentsOf("'{a} {b}")).toEqual([]);
  });
});

const sourceOf = (file: string): string =>
  readFileSync(path.join(SRC_DIR, file), "utf8");

describe("套件內部的依賴方向", () => {
  it.each([
    "locales.ts",
    "base-messages.ts",
    "project-messages.ts",
    "project-admin-messages.ts",
    "icu-arguments.ts",
  ])("%s 不回頭 import index(避免循環依賴)", (file) => {
    expect(sourceOf(file)).not.toMatch(/from\s+"(?:\.|\.\/|\.\/index)"/);
  });

  it("index 只作出口:每一行都是 export … from", () => {
    const statements = sourceOf("index.ts")
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement !== "");
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).toMatch(/^export\s[\s\S]*\sfrom\s+"\.\/[\w-]+"$/);
    }
  });

  it("通用組裝函式不讀專案 package", () => {
    const manifest = readFileSync(
      path.join(SRC_DIR, "..", "package.json"),
      "utf8",
    );
    expect(manifest).not.toContain("@repo/project-config");
    for (const file of readdirSync(SRC_DIR)) {
      if (file.endsWith(".test.ts")) {
        continue;
      }
      expect({
        file,
        hit: sourceOf(file).includes("@repo/project-config"),
      }).toEqual({ file, hit: false });
    }
  });
});
