import { useMemo } from "react";

import type { FieldDef } from "@repo/domain/form";
import {
  useFormVersionQuery,
  useFormsQuery,
  useRolesQuery,
} from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import { definitionOf as formDefinitionOf } from "@/lib/base/form-engine/definition";

export interface CatalogForm {
  key: string;
  name: string;
  currentVersion: number | null;
}

/** 某張表單目前版本的欄位(`null` = 還沒載入或讀不到)。 */
export const useFormFields = (
  formKey: string | null,
  forms: readonly CatalogForm[],
): readonly FieldDef[] | null => {
  const { session } = useSession();
  const version = forms.find((form) => form.key === formKey)?.currentVersion;
  const query = useFormVersionQuery(
    session.client,
    { formKey: formKey ?? "", version: version ?? 0 },
    {
      enabled: formKey !== null && version !== null && version !== undefined,
      retry: false,
    },
  );
  const raw = query.data?.formVersion.formVersion;
  return useMemo(
    () => (raw === undefined ? null : formDefinitionOf(raw).fields),
    [raw],
  );
};

/** 目錄一次抓幾筆(api 上限 100);表單超過就提示「清單已截斷」。 */
const CATALOG_PAGE_SIZE = 100;

/**
 * 設計器要的目錄:看得到的表單(「檢查用表單」、表單欄位來源),與本租戶角色的 id(人員條件的本地檢查)。
 * 借表單管理的 `forms` 與角色管理的 `roles` 查詢(同一群管理員會有這兩把 view);拿不到就是空清單,
 * 存草稿 / 發布時 api 的檢查器照樣把關。
 */
export const useDesignerCatalog = (isShared: boolean) => {
  const { session } = useSession();
  const forms = useFormsQuery(
    session.client,
    { input: { page: 1, pageSize: CATALOG_PAGE_SIZE } },
    { retry: false },
  );
  const roles = useRolesQuery(
    session.client,
    { input: { page: 1, pageSize: CATALOG_PAGE_SIZE } },
    { enabled: !isShared, retry: false },
  );
  const formItems = useMemo<CatalogForm[]>(
    () =>
      (forms.data?.forms.items ?? []).map((form) => ({
        key: form.key,
        name: form.name,
        currentVersion: form.currentVersion ?? null,
      })),
    [forms.data],
  );
  const tenantRoleIds = useMemo(() => {
    const page = roles.data?.roles;
    // 只在拿到**完整**清單時才做本地的「不是本租戶的角色」檢查;超過一頁(或拿不到)交給 api,免得誤報
    if (
      !roles.isSuccess ||
      page === undefined ||
      page.totalCount > page.items.length
    ) {
      return;
    }
    return new Set(page.items.map((role) => role.id));
  }, [roles.isSuccess, roles.data]);
  return {
    /** 表單超過一頁:下拉只列得到前 100 張 */
    isTruncated: (forms.data?.forms.totalCount ?? 0) > formItems.length,
    forms: formItems,
    /** 本租戶角色的完整 id 清單;不完整或拿不到 → undefined(交給 api) */
    tenantRoleIds,
  };
};
