import { type ComponentType, Suspense, useMemo } from "react";
import { Navigate, useLocation } from "react-router";
import { useTranslations } from "use-intl";

import { CircularProgress } from "@repo/ui/circular-progress";

import { useMe } from "@/hooks/base/useMe";
import {
  type ModulePageProps,
  buildNavTree,
  enterableRouteMap,
  findNavNode,
  firstLinkRoute,
  matchModuleRoute,
  normalizePathname,
} from "@/lib/base/module-tree";

import { ForbiddenPage } from "../ForbiddenPage";
import { ModulePage } from "./ModulePage";

/** 模組 key → 頁面元件;沒登記的模組用佔位頁 `ModulePage`(組裝在 app/module-pages.tsx)。 */
export type ModulePageRegistry = Readonly<
  Record<string, ComponentType<ModulePageProps>>
>;

export interface ModuleRouteProps {
  pages: ModulePageRegistry;
}

/**
 * 模組路由(ADR-0011「路由與導向規則」):
 * - 網址在「可進入路由集合」內 → 該模組的頁面(登記過的元件,否則佔位頁);
 *   隱藏頁多一段識別碼(`/…/view-page/<id>`)也算命中,那一段以 `routeParam` 傳給頁面(`matchModuleRoute`)
 * - `/` 或群組路由 → 轉到側欄(該群組)第一個能進的 link;一個都沒有 → 無權限頁
 * - 其餘 → 無權限頁(明確提示是權限問題,不是壞掉)
 */
export const ModuleRoute = ({ pages }: ModuleRouteProps) => {
  const t = useTranslations("admin.app");
  const me = useMe();
  const { pathname } = useLocation();
  const modules = me.data?.me.modules;

  const routes = useMemo(() => enterableRouteMap(modules ?? []), [modules]);
  const tree = useMemo(() => buildNavTree(modules ?? []), [modules]);

  if (modules === undefined) {
    // RequireAuth 已等 `me` 載入;走到這裡代表載入失敗,殼已顯示錯誤
    return null;
  }

  const path = normalizePathname(pathname);
  const matched = matchModuleRoute(routes, path);
  if (matched !== undefined) {
    const Page = pages[matched.module.key] ?? ModulePage;
    // 懶載入的頁面(表單管理、表單模組預設組裝)在 chunk 到之前先顯示載入中
    return (
      <Suspense fallback={<CircularProgress aria-label={t("loading")} />}>
        <Page module={matched.module} routeParam={matched.param} />
      </Suspense>
    );
  }

  const scope = path === "/" ? tree : findNavNode(tree, path)?.children;
  const target = scope === undefined ? null : firstLinkRoute(scope);
  if (target !== null) {
    return <Navigate to={target} replace />;
  }

  return <ForbiddenPage isEntry={path === "/"} />;
};
