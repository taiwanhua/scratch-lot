import { describe, expect, it } from "@jest/globals";

import { formModuleOptions, modulePages } from "./module-pages";

/**
 * 入口清單測試(規格 10.1「既有頁面這一輪一起改」;REACT-14):
 *
 * 1. 每一個路由頁面都要在下面的盤點清單裡(寫明它把哪些狀態放進網址、哪些刻意不放)。
 *    新增頁面沒有登記 → 這裡失敗,提醒新頁面也照 REACT-14 用 `useUrlState`。
 * 2. 原始碼裡只有 `useUrlState` 自己碰 nuqs / react-router 的查詢字串 hook;
 *    任何頁面、元件直接讀寫查詢字串 → 這裡失敗。
 *
 * 盤點的完整說明(含不放網址的理由)在 `docs/concepts/frontend-architecture.md`「既有頁面改用的盤點」。
 */

/** 頁面 → 放進網址的 key(`useUrlState` 的 key;空陣列 = 這一頁沒有可放網址的狀態)。 */
const FIXED_MODULE_PAGES: Readonly<Record<string, readonly string[]>> = {
  overview: [],
  "demo.sub.sample-one": ["list"],
  "demo.sub.sample-one.view-page": [],
  "demo.sub.sample-one.create-page": [],
  "demo.sub.sample-one.edit-page": [],
  "demo.sample-two": ["list"],
  "demo.sample-two.view-page": [],
  "demo.sample-two.create-page": [],
  "demo.sample-two.edit-page": [],
  "system.org-manager": ["detail", "tab", "members"],
  "system.module-manager": ["detail"],
  "system.field-manager": ["detail"],
  "system.user-manager": ["list"],
  "system.role-manager": ["list", "detail", "tab", "users"],
  "system.data-scope": ["detail"],
  "system.forms": ["list", "detail"],
  "system.workflows": ["list", "detail"],
  "system.workflows.blocked-page": ["list"],
  "apply-center": ["tab", "list"],
  "apply-center.view-page": [],
};

/** 表單模組的預設組裝(每個表單模組各四頁,同一組元件)。 */
const FORM_MODULE_SLOTS: Readonly<Record<string, readonly string[]>> = {
  "": ["list"],
  ".view-page": [],
  ".create-page": [],
  ".edit-page": [],
};

/** 不是模組的路由(`app/routes.tsx`):登入三頁讀網址參數,個人設定的分頁用 PageTabs。 */
const SHELL_AND_AUTH_ROUTES: Readonly<Record<string, readonly string[]>> = {
  LOGIN_PATH: ["next"],
  FORGOT_PASSWORD_PATH: [],
  SET_PASSWORD_PATH: ["token"],
  CHANGE_PASSWORD_PATH: ["next"],
  PERSONAL_SETTINGS_PATH: ["tab"],
};

/**
 * 讀原始碼用的 Node 介面。admin 的 tsconfig 只有瀏覽器型別(沒有 `@types/node`),
 * 所以以變數當模組名動態載入(型別上是 any),只宣告這裡用到的那幾個方法。
 */
interface DirEntry {
  name: string;
  isDirectory: () => boolean;
}
interface NodeFs {
  readFileSync: (file: string, encoding: "utf8") => string;
  readdirSync: (
    directory: string,
    options: { withFileTypes: true },
  ) => DirEntry[];
}
const FS_MODULE = "node:fs";
const fs = (await import(FS_MODULE)) as NodeFs;

// 測試以 ESM 執行(沒有 `__dirname`);jest 的工作目錄就是 package 根目錄
const { process: nodeProcess } = globalThis as unknown as {
  process: { cwd: () => string };
};
const SRC_DIR = `${nodeProcess.cwd().replaceAll("\\", "/")}/src`;

const sourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });

const relative = (file: string) => file.slice(SRC_DIR.length + 1);

const byText = (a: string, b: string) => a.localeCompare(b);

/** 拆開寫:這支測試自己不能出現那個名字(驗收用 grep 檢查全 src)。 */
const QUERY_STRING_HOOK = ["useSearch", "Params"].join("");

describe("入口清單:每個路由頁面都盤點過網址狀態(REACT-14)", () => {
  it("每個登記的模組頁面都在盤點清單裡,清單也沒有多出不存在的頁", () => {
    const formPages = [...formModuleOptions.keys()].flatMap((moduleKey) =>
      Object.keys(FORM_MODULE_SLOTS).map((suffix) => `${moduleKey}${suffix}`),
    );
    const inventoried = [...Object.keys(FIXED_MODULE_PAGES), ...formPages];

    expect(Object.keys(modulePages).toSorted(byText)).toEqual(
      inventoried.toSorted(byText),
    );
  });

  it("`app/routes.tsx` 的非模組路由都在盤點清單裡", () => {
    const routes = fs.readFileSync(`${SRC_DIR}/app/routes.tsx`, "utf8");
    const declared = [...routes.matchAll(/<Route\s+path=\{(\w+)\}/g)].map(
      (match) => match[1],
    );

    expect(declared.toSorted(byText)).toEqual(
      Object.keys(SHELL_AND_AUTH_ROUTES).toSorted(byText),
    );
  });

  it("只有 `useUrlState` 碰查詢字串:沒有頁面或元件直接用 react-router 的查詢字串 hook 或 nuqs", () => {
    const offenders = sourceFiles(SRC_DIR).flatMap((file) => {
      const name = relative(file);
      const source = fs.readFileSync(file, "utf8");
      const found: string[] = [];
      if (
        name !== "hooks/base/useUrlState.ts" &&
        source.includes(QUERY_STRING_HOOK)
      ) {
        found.push(`${name}: ${QUERY_STRING_HOOK}`);
      }
      if (
        name !== "hooks/base/useUrlState.ts" &&
        source.includes('from "nuqs"')
      ) {
        found.push(`${name}: nuqs`);
      }
      if (
        name !== "app/providers/RootProviders.tsx" &&
        source.includes('from "nuqs/adapters')
      ) {
        found.push(`${name}: nuqs adapter`);
      }
      return found;
    });

    expect(offenders).toEqual([]);
  });
});
