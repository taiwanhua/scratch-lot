import { describe, expect, it } from "@jest/globals";

import { resolveAccountLocale } from "./locale";

describe("resolveAccountLocale(登入後該用哪個語言)", () => {
  it("帳號有支援的語言 → 用帳號的,不寫回", () => {
    expect(resolveAccountLocale("en", "zh-TW")).toEqual({
      locale: "en",
      writeBack: false,
    });
  });

  it.each([null, undefined, "fr", 42])(
    "帳號沒有語言或認不得(%p)→ 用本機快取並寫回",
    (accountLocale) => {
      expect(resolveAccountLocale(accountLocale, "en")).toEqual({
        locale: "en",
        writeBack: true,
      });
    },
  );
});
