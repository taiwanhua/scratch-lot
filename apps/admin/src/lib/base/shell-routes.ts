import { ModuleEngine, ModuleSidebarType } from "@repo/graphql";

import type { ShellModule } from "./module-tree";
import { PERSONAL_SETTINGS_PATH } from "./paths";

/** 個人設定在殼裡的識別 key:路由頁籤、AppBar 的「?」說明(`md/module-help/base/personal-settings.help.md`)都用它。 */
export const PERSONAL_SETTINGS_KEY = "personal-settings";

export interface ShellRouteLabels {
  /** 個人設定的名稱(AppBar 頁名、路由頁籤) */
  personalSettings: string;
}

/**
 * 殼層路由(不是模組、不分配給角色,所有登入者都能開;比照 `/change-password`,但開在殼裡、開成一個路由頁籤):
 * 以一筆**不在側欄**的頁面形狀併進「可進入路由集合」,殼的頁名、「?」說明與路由頁籤就與模組頁走同一條路。
 * 只給殼用(`ShellLayout`);`ModuleRoute` 的權限判斷不吃這份 —— 頁面本身由 `routes.tsx` 的固定路由渲染。
 */
const shellRouteModules = (labels: ShellRouteLabels): ShellModule[] => [
  {
    id: `shell:${PERSONAL_SETTINGS_KEY}`,
    key: PERSONAL_SETTINGS_KEY,
    name: labels.personalSettings,
    parentId: null,
    // 精準比對(link 不吃網址尾端多一段的退路);不進側欄:側欄樹只看 `me.modules`
    sidebarType: ModuleSidebarType.Link,
    engine: ModuleEngine.Fixed,
    order: 0,
    route: PERSONAL_SETTINGS_PATH,
    icon: null,
    permissions: [],
  },
];

/** 模組的可進入路由集合 + 殼層路由。殼層路由的網址不會與模組撞(模組路由由 seed 決定,沒有 `/settings/personal`)。 */
export const withShellRoutes = (
  routes: ReadonlyMap<string, ShellModule>,
  labels: ShellRouteLabels,
): ReadonlyMap<string, ShellModule> => {
  const merged = new Map(routes);
  for (const module of shellRouteModules(labels)) {
    if (module.route !== null && module.route !== undefined) {
      merged.set(module.route, module);
    }
  }
  return merged;
};
