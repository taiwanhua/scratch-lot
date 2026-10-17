import { useEffect } from "react";
import { useLocation } from "react-router";
import { useTranslations } from "use-intl";

import type { TabLabelAction } from "@/lib/base/form-engine/tab-label";
import { normalizePathname } from "@/lib/base/module-tree";
import { useRouteTabsStore } from "@/stores/base/useRouteTabsStore";

/**
 * 詳情子頁籤的項目名(ADR-0011「頁籤兩種」):詳情 / 編輯這類帶識別碼的隱藏頁,拿到那一筆之後呼叫,
 * 殼的路由頁籤就顯示成「所屬模組名 — 項目名」。資料還沒到(`undefined` / `null` / 空字串)時不動,
 * 頁籤先顯示網址對上的模組名。
 *
 * `action`(頁面種類)有給時把「檢視 / 編輯」接在項目名最前面(「檢視・項目名」),組法與表單模組的
 * `{{action}}` 是同一則字典訊息(`admin.formEngine.pages.tabLabelWithAction`);固定欄位模組的詳情 / 編輯頁用它。
 * 表單模組的項目名已由頁籤模板算好(含 `{{action}}`),不給 `action`。
 *
 * 頁籤以目前網址為 id,所以這裡直接讀網址,頁面不必自己組路由字串。
 * store action 放在 effect 內(REACT-06:render 期間只允許冪等的初始化)。
 */
export const useRouteTabItemLabel = (
  itemLabel: string | null | undefined,
  action?: TabLabelAction,
): void => {
  const { pathname } = useLocation();
  const tPages = useTranslations("admin.formEngine.pages");
  const setItemLabel = useRouteTabsStore((state) => state.setItemLabel);
  const route = normalizePathname(pathname);

  const withAction = (label: string): string =>
    action === undefined
      ? label
      : tPages("tabLabelWithAction", {
          action: tPages(`actions.${action}`),
          label,
        });
  // 資料還沒到(`undefined` / `null` / 空字串)→ 不動
  const tabLabel = itemLabel ? withAction(itemLabel) : null;

  useEffect(() => {
    if (tabLabel !== null) {
      setItemLabel(route, tabLabel);
    }
  }, [setItemLabel, route, tabLabel]);
};
