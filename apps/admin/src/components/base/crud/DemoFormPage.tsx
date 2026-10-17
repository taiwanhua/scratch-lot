import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";

import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { DemoForm } from "./DemoForm";
import { demoErrorOf } from "./demo-error";
import type { DemoItemLike, DemoModuleConfig } from "./demo-module-config";
import { useDemoAccess } from "./useDemoAccess";

export interface DemoFormPageProps<
  Row extends DemoItemLike,
  Detail extends DemoItemLike,
  Values,
> extends ModulePageProps {
  config: DemoModuleConfig<Row, Detail, Values>;
}

/**
 * 設定驅動的新增 / 編輯頁(隱藏頁模組 `create-page` / `edit-page`,**共版型**;Figma 175:558)。
 *
 * 兩個模組 key 都登記到這一個元件,情境由 `module.key` 判斷 —— 這正是示範家族要示範的
 * 「同一份版型兩種情境」。編輯情境的 `<id>` 由殼的路由防守解出來傳進 `routeParam`。
 *
 * 這一層只做 gate:編輯要先把那一筆取回來,資料到了才掛表單(表單的初始值只取一次,REACT-08)。
 */
export const DemoFormPage = <
  Row extends DemoItemLike,
  Detail extends DemoItemLike,
  Values,
>({
  config,
  module,
  routeParam,
}: DemoFormPageProps<Row, Detail, Values>) => {
  const { i18nNamespace } = config;
  const t = useTranslations(i18nNamespace);
  const tErrors = useTranslations(`${i18nNamespace}.errors`);
  const navigate = useNavigate();
  const access = useDemoAccess(config.moduleKeys, config.permissions);

  const isEdit = module.key === config.moduleKeys.editPage;
  const itemId = routeParam ?? "";
  const query = config.detail.useItem(itemId, isEdit && itemId !== "");
  // 編輯情境的路由頁籤顯示「模組名 — 編輯・項目名」;新增情境沒有項目,維持模組名
  useRouteTabItemLabel(isEdit ? query.item?.name : null, "edit");

  const tabHref = useRouteTabHref();
  const leave = () => {
    if (access.listRoute !== null) {
      void navigate(tabHref(access.listRoute));
    }
  };

  if (isEdit && query.isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }

  if (isEdit && query.item === null) {
    return (
      <Alert severity="error">
        {tErrors(
          query.error === null ? "NOT_FOUND" : demoErrorOf(query.error).code,
        )}
      </Alert>
    );
  }

  return (
    <Card sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 3, py: 2.5 }}>
      <DemoForm
        i18nNamespace={i18nNamespace}
        form={config.form}
        item={isEdit ? query.item : null}
        access={access}
        onLeave={leave}
      />
    </Card>
  );
};
