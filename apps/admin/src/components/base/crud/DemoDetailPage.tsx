import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useCloseItemTabs } from "@/hooks/base/useCloseItemTabs";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { DeleteItemDialog } from "./DeleteItemDialog";
import { DemoFieldRow } from "./DemoFieldRow";
import { type DemoErrorCode, demoErrorOf } from "./demo-error";
import type { DemoItemLike, DemoModuleConfig } from "./demo-module-config";
import { useDemoAccess } from "./useDemoAccess";

export interface DemoDetailPageProps<
  Row extends DemoItemLike,
  Detail extends DemoItemLike,
  Values,
> extends ModulePageProps {
  config: DemoModuleConfig<Row, Detail, Values>;
}

/**
 * 設定驅動的詳情頁(隱藏頁模組 `<模組>.view-page`;Figma 175:318)。
 *
 * 網址是 `/<模組路由>/view-page/<id>`,`<id>` 由殼的路由防守解出來傳進 `routeParam`
 * (`lib/base/module-tree.ts` 的 `matchModuleRoute`);沒綁這個模組的人根本走不到這裡。
 *
 * 欄位表由 `config.detail.fields` 決定。每一列的 `isVisible` 就是**欄位級權限**的接縫:
 * 沒有權限時整列不渲染,**不是顯示空值** —— 值是 null 也可能只是沒填,拿值猜權限是錯的。
 */
export const DemoDetailPage = <
  Row extends DemoItemLike,
  Detail extends DemoItemLike,
  Values,
>({
  config,
  routeParam,
}: DemoDetailPageProps<Row, Detail, Values>) => {
  const { i18nNamespace } = config;
  const t = useTranslations(i18nNamespace);
  const tFields = useTranslations(`${i18nNamespace}.fields`);
  const tActions = useTranslations(`${i18nNamespace}.actions`);
  const tErrors = useTranslations(`${i18nNamespace}.errors`);
  const { session } = useSession();
  const navigate = useNavigate();
  const access = useDemoAccess(config.moduleKeys, config.permissions);

  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<DemoErrorCode | null>(null);

  const query = config.detail.useItem(routeParam ?? "", true);
  const { item } = query;
  // 路由頁籤顯示「模組名 — 檢視・項目名」
  useRouteTabItemLabel(item?.name, "view");
  const closeItemTabs = useCloseItemTabs();

  const tabHref = useRouteTabHref();
  /** 回列表帶回列表頁籤記下的條件;進某一筆(編輯頁)是新的網址,不帶參數。 */
  const goTo = (route: string | null, id?: string) => {
    if (route === null) {
      return;
    }
    void navigate(id === undefined ? tabHref(route) : `${route}/${id}`);
  };

  /** `useDelete` 只收 `{ onSuccess(): void; … }`,所以回饋在這一層自己報一次(#376)。 */
  const feedback = useMutationFeedback({
    success: t("feedback.deleteSuccess"),
    error: (error: unknown) => tErrors(demoErrorOf(error).code),
  });

  const deleteItem = config.useDelete(session.client, {
    onSuccess: () => {
      feedback.onSuccess();
      setIsDeleting(false);
      // 關掉這一筆的詳情 / 編輯子頁籤;當前頁籤就是詳情 → 導向列表
      closeItemTabs({
        pageRoutes: [access.viewRoute, access.editRoute],
        id: routeParam ?? "",
        listRoute: access.listRoute,
      });
    },
    onError: (error: unknown) => {
      feedback.onError(error);
      setActionError(demoErrorOf(error).code);
    },
  });

  if (query.isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }

  if (item === null) {
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
      <Stack spacing={2.25}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Button
            variant="text"
            size="small"
            onClick={() => {
              goTo(access.listRoute);
            }}
          >
            {tActions("backToList")}
          </Button>
          <Box sx={{ flex: 1 }} />
          {item.abilities.canDelete && (
            <Button
              variant="text"
              color="error"
              onClick={() => {
                setActionError(null);
                setIsDeleting(true);
              }}
            >
              {tActions("delete")}
            </Button>
          )}
          {access.editRoute !== null && item.abilities.canEdit && (
            <Button
              onClick={() => {
                goTo(access.editRoute, item.id);
              }}
            >
              {tActions("edit")}
            </Button>
          )}
        </Stack>

        <Typography variant="h6" component="h1">
          {item.name}
        </Typography>

        {config.detail.fields
          .filter((field) => field.isVisible?.(access, item) ?? true)
          .map((field) => (
            <DemoFieldRow key={field.key} label={tFields(field.key)}>
              {field.render(item, t)}
            </DemoFieldRow>
          ))}

        {actionError !== null && !isDeleting && (
          <Alert severity="error">{tErrors(actionError)}</Alert>
        )}
      </Stack>

      {isDeleting && (
        <DeleteItemDialog
          i18nNamespace={i18nNamespace}
          itemName={item.name}
          isSubmitting={deleteItem.isPending}
          errorCode={actionError}
          onCancel={() => {
            setActionError(null);
            setIsDeleting(false);
          }}
          onConfirm={() => {
            setActionError(null);
            deleteItem.mutate({ input: { id: item.id } });
          }}
        />
      )}
    </Card>
  );
};
