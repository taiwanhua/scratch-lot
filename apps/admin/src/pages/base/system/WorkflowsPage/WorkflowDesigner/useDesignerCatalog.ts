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

export interface CatalogRole {
  id: string;
  name: string;
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

/** 目錄一次抓幾筆(api 上限 100);超過就提示「清單已截斷」。 */
const CATALOG_PAGE_SIZE = 100;

/**
 * 設計器要的目錄:看得到的表單(「檢查用表單」、表單欄位來源)、本租戶的角色(客製流程的角色來源)。
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
  const roleItems = useMemo<CatalogRole[]>(
    () =>
      (roles.data?.roles.items ?? []).map((role) => ({
        id: role.id,
        name: role.name,
      })),
    [roles.data],
  );
  const isTruncated =
    (forms.data?.forms.totalCount ?? 0) > formItems.length ||
    (roles.data?.roles.totalCount ?? 0) > roleItems.length;
  return {
    /** 表單或角色超過一頁:下拉只列得到前 100 筆 */
    isTruncated,
    forms: formItems,
    roles: roleItems,
    /** 角色清單拿到了才拿來檢查「不是本租戶的角色」(拿不到就交給 api) */
    tenantRoleIds: roles.isSuccess
      ? new Set(roleItems.map((role) => role.id))
      : undefined,
  };
};
