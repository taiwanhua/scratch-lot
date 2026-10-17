import { afterEach, describe, expect, it } from "@jest/globals";

import { COLOR_MODE_STORAGE_KEY, COLOR_SCHEME_STORAGE_KEY } from "./color-mode";
import { colorModeInitScript, colorModeInitTag } from "./color-mode-init";

const setSystemPrefersDark = (prefersDark: boolean): void => {
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" && prefersDark,
    }),
  });
};

/** 真的執行腳本(與瀏覽器載入 html 時相同:以 `<script>` 插進 head),回傳 `<html>` 上的 class。 */
const runScript = (script: string): string[] => {
  const element = document.createElement("script");
  element.textContent = script;
  document.head.append(element);
  element.remove();
  return [...document.documentElement.classList];
};

describe("首幀外觀腳本", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    Reflect.deleteProperty(globalThis, "matchMedia");
  });

  it("用和 useColorMode 相同的 storage key,依模式與系統偏好決定 class", () => {
    const script = colorModeInitScript();
    expect(script).toContain(`"${COLOR_MODE_STORAGE_KEY}"`);
    expect(script).toContain(`"${COLOR_SCHEME_STORAGE_KEY}-light"`);
    expect(script).toContain(`"${COLOR_SCHEME_STORAGE_KEY}-dark"`);
    expect(script).toContain("prefers-color-scheme: dark");
    expect(script).toContain("document.documentElement.classList.add");
  });

  it("注入 head 的 script 標籤", () => {
    const tag = colorModeInitTag();
    expect(tag.tag).toBe("script");
    expect(tag.injectTo).toBe("head");
    expect(tag.children).toContain(COLOR_MODE_STORAGE_KEY);
  });

  describe("實際執行(預設腳本 = Provider 用的同一組 key)", () => {
    it("存了暗色 → 系統偏好亮色也套 dark", () => {
      setSystemPrefersDark(false);
      localStorage.setItem(COLOR_MODE_STORAGE_KEY, "dark");

      expect(runScript(colorModeInitScript())).toEqual(["dark"]);
    });

    it("存了亮色 → 系統偏好暗色也套 light", () => {
      setSystemPrefersDark(true);
      localStorage.setItem(COLOR_MODE_STORAGE_KEY, "light");

      expect(runScript(colorModeInitScript())).toEqual(["light"]);
    });

    it.each([
      [true, "dark"],
      [false, "light"],
    ])("跟隨系統(系統偏好暗色 = %p)→ %s", (prefersDark, expected) => {
      setSystemPrefersDark(prefersDark);
      localStorage.setItem(COLOR_MODE_STORAGE_KEY, "system");

      expect(runScript(colorModeInitScript())).toEqual([expected]);
    });

    it("什麼都沒存 → 當作跟隨系統", () => {
      setSystemPrefersDark(true);

      expect(runScript(colorModeInitScript())).toEqual(["dark"]);
    });

    it("MUI 另存的配色名稱(`<前綴>-dark`)會被採用", () => {
      setSystemPrefersDark(false);
      localStorage.setItem(COLOR_MODE_STORAGE_KEY, "dark");
      localStorage.setItem(`${COLOR_SCHEME_STORAGE_KEY}-dark`, "dim");

      expect(runScript(colorModeInitScript())).toEqual(["dim"]);
    });
  });

  it("別的 namespace 的腳本不讀本專案存的外觀", () => {
    setSystemPrefersDark(false);
    localStorage.setItem(COLOR_MODE_STORAGE_KEY, "dark");

    // 對照鍵由目前的鍵加固定後綴組成:不論專案的 slug 是什麼,都保證與本專案的鍵不同
    expect(
      runScript(
        colorModeInitScript(
          `${COLOR_MODE_STORAGE_KEY}-other-namespace`,
          `${COLOR_SCHEME_STORAGE_KEY}-other-namespace`,
        ),
      ),
    ).toEqual(["light"]);
  });
});
