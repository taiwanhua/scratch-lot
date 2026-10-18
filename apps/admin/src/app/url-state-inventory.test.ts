import { describe, expect, it } from "@jest/globals";
import {
  Children,
  type ReactElement,
  type ReactNode,
  isValidElement,
} from "react";

import { baseModulePages } from "./base/module-pages";
import {
  baseUrlStateInventory,
  nonModuleRouteUrlStateInventory,
} from "./base/url-state-inventory";
import type { ModulePageSource } from "./module-page-registry";
import { projectUrlStateCoverage } from "./module-pages";
import { AppRoutes } from "./routes";

/**
 * 入口清單測試(REACT-14):每一個路由頁面都要登記它以 `useUrlState`
 * 放進網址的 key,新頁面沒登記 → 這裡失敗,提醒新頁面也照 REACT-14 做。
 * 「只有 `useUrlState` 能碰查詢字串」由 ESLint 擋(`apps/admin/eslint.config.js` 的 `no-restricted-imports`)。
 *
 * 底座只比對底座來源、專案只比對專案來源:專案加頁面只改 `app/project/`,不碰底座的盤點表。
 */

const byText = (a: string, b: string) => a.localeCompare(b);

/**
 * 一個來源裡要個別登記的頁:固定頁 + 表單模組單頁客製過的頁。
 * 表單模組沒客製的頁沿用預設組裝的盤點(`formModuleUrlStateInventory`),不必逐一登記。
 */
const pagesToInventory = ({ pages, forms }: ModulePageSource): string[] => [
  ...pages.map((page) => page.key),
  ...forms.flatMap(({ moduleKey, pageOverrides }) =>
    Object.keys(pageOverrides ?? {}).map((slot) =>
      slot === "list" ? moduleKey : `${moduleKey}.${slotSuffix(slot)}`,
    ),
  ),
];

const slotSuffix = (slot: string) => slot.replace(/Page$/, "-page");

/** `<Routes>` 底下所有寫了 `path` 的 `<Route>`(遞迴,含殼底下的巢狀路由)。 */
const routePaths = (node: ReactNode): string[] =>
  Children.toArray(node).flatMap((child) => {
    if (!isValidElement(child)) {
      return [];
    }
    const { path, children } = (
      child as ReactElement<{
        path?: string;
        children?: ReactNode;
      }>
    ).props;
    return [...(path === undefined ? [] : [path]), ...routePaths(children)];
  });

describe("入口清單:每個路由頁面都盤點過網址狀態(REACT-14)", () => {
  it("底座:`baseModulePages` 的每一頁都在底座盤點表,盤點表也沒有多出不存在的頁", () => {
    expect(Object.keys(baseUrlStateInventory).toSorted(byText)).toEqual(
      pagesToInventory(baseModulePages).toSorted(byText),
    );
  });

  it("專案:新增的頁、客製的頁、換掉的底座頁都在 `app/project/url-state-inventory.ts`", () => {
    const { source, replacements, inventory } = projectUrlStateCoverage;
    expect(Object.keys(inventory).toSorted(byText)).toEqual(
      [
        ...pagesToInventory(source),
        ...replacements.map((replacement) => replacement.target),
      ].toSorted(byText),
    );
  });

  it("`app/routes.tsx` 的非模組路由都在盤點表(`/` 與 `*` 交給模組頁)", () => {
    const routes = AppRoutes() as ReactElement<{ children?: ReactNode }>;
    const paths = routePaths(routes.props.children).filter(
      (path) => path !== "/" && path !== "*",
    );

    expect(paths.toSorted(byText)).toEqual(
      Object.keys(nonModuleRouteUrlStateInventory).toSorted(byText),
    );
  });
});
