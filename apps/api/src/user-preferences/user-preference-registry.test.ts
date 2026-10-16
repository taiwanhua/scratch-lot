import { describe, expect, it } from "@jest/globals";

import {
  BASE_USER_PREFERENCES,
  LOCALE_PREFERENCE_KEY,
  UserPreferenceRegistryError,
  composeUserPreferences,
  isValidPreferenceValue,
} from "./user-preference-registry";

describe("個人偏好的登記", () => {
  it("底座登記語言:字串、預設 null(沒有設定)", () => {
    const registry = composeUserPreferences(BASE_USER_PREFERENCES, []);
    expect(registry.get(LOCALE_PREFERENCE_KEY)).toMatchObject({
      type: "string",
      defaultValue: null,
    });
  });

  it("專案可以追加 key", () => {
    const registry = composeUserPreferences(BASE_USER_PREFERENCES, [
      { key: "lotteryView", type: "boolean", defaultValue: false },
    ]);
    expect([...registry.keys()]).toEqual([
      LOCALE_PREFERENCE_KEY,
      "lotteryView",
    ]);
  });

  it("專案與底座的 key 重複 → 起不來", () => {
    expect(() =>
      composeUserPreferences(BASE_USER_PREFERENCES, [
        { key: LOCALE_PREFERENCE_KEY, type: "string", defaultValue: null },
      ]),
    ).toThrow(UserPreferenceRegistryError);
  });

  it.each(["", "a.b", "$set", "1abc", "has space"])(
    "key 格式不對(%s)→ 起不來",
    (key) => {
      expect(() =>
        composeUserPreferences(
          [],
          [{ key, type: "boolean", defaultValue: null }],
        ),
      ).toThrow(UserPreferenceRegistryError);
    },
  );

  it("預設值不合型別 → 起不來", () => {
    expect(() =>
      composeUserPreferences(
        [],
        [{ key: "flag", type: "boolean", defaultValue: "yes" }],
      ),
    ).toThrow(UserPreferenceRegistryError);
  });

  it("型別檢查:boolean / number / string 的格式與長度", () => {
    const flag = { key: "flag", type: "boolean", defaultValue: null } as const;
    const count = { key: "count", type: "number", defaultValue: null } as const;
    const [locale] = BASE_USER_PREFERENCES;
    if (locale === undefined) {
      throw new Error("底座沒有登記語言");
    }
    expect(isValidPreferenceValue(flag, true)).toBe(true);
    expect(isValidPreferenceValue(flag, "true")).toBe(false);
    expect(isValidPreferenceValue(count, 3)).toBe(true);
    expect(isValidPreferenceValue(count, Number.NaN)).toBe(false);
    expect(isValidPreferenceValue(locale, "zh-TW")).toBe(true);
    expect(isValidPreferenceValue(locale, "en")).toBe(true);
    expect(isValidPreferenceValue(locale, "EN")).toBe(false);
    expect(isValidPreferenceValue(locale, "zh-TW-extra-long-tag-x")).toBe(
      false,
    );
  });
});
