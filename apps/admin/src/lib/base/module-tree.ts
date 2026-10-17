import { type MeQuery, ModuleSidebarType } from "@repo/graphql";

/** `me.modules` 的單筆(ADR-0011 步驟 7:route 為完整路徑、api 樹 route 為 null、permissions 為完整 key)。 */
export type ShellModule = MeQuery["me"]["modules"][number];

export interface NavNode {
  module: ShellModule;
  children: NavNode[];
}

/** 模組頁面元件的 props:`app/module-pages.tsx` 登記的頁面與佔位頁共用(放 lib 讓 pages 不必 import app,STRUCT-03)。 */
export interface ModulePageProps {
  module: ShellModule;
  /**
   * 網址尾端的動態參數(詳情 / 編輯這類隱藏頁的 `/view-page/<id>` 的 id);
   * 精準命中模組路由(列表頁、新增頁)時為 null。由 `matchModuleRoute` 解出來、`ModuleRoute` 傳進來。
   */
  routeParam?: string | null;
}

/** 同層排序:order → key(ADR-0011:陣列順序不可信,前端仍以 parentId 組樹後自行排序)。 */
const byOrder = (a: ShellModule, b: ShellModule): number =>
  a.order - b.order || a.key.localeCompare(b.key);

/** 進得了側欄的節點:有路由,且不是隱藏頁(api 樹 route 為 null,一併略過)。 */
const isSidebarVisible = (module: ShellModule): boolean =>
  module.route !== null &&
  module.route !== undefined &&
  module.sidebarType !== ModuleSidebarType.Hidden;

/**
 * 模組陣列 → 側欄樹(ADR-0011「前端判斷 / 側欄」):以 parentId 組樹,group 可展開、link 為連結、hidden 不顯示。
 * 父節點不在陣列內(或父節點本身不可見)的模組視為根節點,不會憑空消失。
 */
export const buildNavTree = (modules: readonly ShellModule[]): NavNode[] => {
  const visible = modules.filter((module) => isSidebarVisible(module));
  const visibleIds = new Set(visible.map((module) => module.id));
  const childrenOf = new Map<string | null, ShellModule[]>();

  for (const module of visible) {
    const parentId =
      module.parentId !== null &&
      module.parentId !== undefined &&
      visibleIds.has(module.parentId)
        ? module.parentId
        : null;
    const siblings = childrenOf.get(parentId) ?? [];
    siblings.push(module);
    childrenOf.set(parentId, siblings);
  }

  const build = (parentId: string | null): NavNode[] =>
    (childrenOf.get(parentId) ?? [])
      .toSorted(byOrder)
      .map((module) => ({ module, children: build(module.id) }));

  return build(null);
};

/** 網址正規化:去掉結尾的 `/`(根路徑除外),讓 `/system/org-manager/` 也能對上路由集合。 */
export const normalizePathname = (pathname: string): string => {
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === "/") {
    end -= 1;
  }
  return end === 0 ? "/" : pathname.slice(0, end);
};

/** 在側欄樹裡找 route 等於此路徑的節點(深度優先);找不到回 undefined。 */
export const findNavNode = (
  nodes: readonly NavNode[],
  route: string,
): NavNode | undefined => {
  for (const node of nodes) {
    if (node.module.route === route) {
      return node;
    }
    const found = findNavNode(node.children, route);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};

/**
 * 「側欄第一個能進的頁」(ADR-0011「路由與導向規則」):依側欄順序深度優先,第一個 link 模組的路由;沒有則 null。
 * `/` 用整棵樹呼叫、群組路由用該群組的 children 呼叫 — 同一條規則。
 */
export const firstLinkRoute = (nodes: readonly NavNode[]): string | null => {
  for (const node of nodes) {
    if (node.module.sidebarType === ModuleSidebarType.Link) {
      return node.module.route ?? null;
    }
    const route = firstLinkRoute(node.children);
    if (route !== null) {
      return route;
    }
  }
  return null;
};

/**
 * 「可進入路由集合」(ADR-0011「路由防守」):可進 = 有那個模組路由,僅此一條。
 * link 與 hidden(編輯頁等)都是頁面;群組只是側欄節點與路徑前綴,api 樹沒有路由 — 兩者都不在集合內。
 */
export const enterableRouteMap = (
  modules: readonly ShellModule[],
): ReadonlyMap<string, ShellModule> => {
  const routes = new Map<string, ShellModule>();
  for (const module of modules) {
    if (
      module.route !== null &&
      module.route !== undefined &&
      module.sidebarType !== ModuleSidebarType.Group
    ) {
      routes.set(module.route, module);
    }
  }
  return routes;
};

/** 網址對上的模組 + 尾端的動態參數。 */
export interface MatchedModuleRoute {
  module: ShellModule;
  /** `/…/view-page/<id>` 的 id;精準命中模組路由時為 null */
  param: string | null;
}

/**
 * 網址 → 可進入路由集合裡的模組(ADR-0011「路由防守」的比對步驟)。
 *
 * 先精準比對;對不上時**只對隱藏頁**再試一次「去掉最後一段」——
 * 詳情 / 編輯頁的模組路由本身不含識別碼(seed 的 route 是 `view-page` / `edit-page`),
 * 但實際網址是 `/demo/sub/sample-one/view-page/<id>`(#320)。
 *
 * 退路限定 hidden 的理由:link(列表頁)後面多一段就是打錯網址,仍應被擋;
 * 「可進 = 有那個模組路由」這條規則沒有放寬 —— 沒綁隱藏頁模組的人,父路徑查不到,一樣是無權限頁。
 */
export const matchModuleRoute = (
  routes: ReadonlyMap<string, ShellModule>,
  path: string,
): MatchedModuleRoute | undefined => {
  const exact = routes.get(path);
  if (exact !== undefined) {
    return { module: exact, param: null };
  }
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) {
    return undefined;
  }
  const param = path.slice(lastSlash + 1);
  const parent = routes.get(path.slice(0, lastSlash));
  if (param === "" || parent?.sidebarType !== ModuleSidebarType.Hidden) {
    return undefined;
  }
  return { module: parent, param };
};
