import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type RetiredFormPermissionsQuery,
  useDeleteRetiredPermissionMutation,
  useRetiredFormPermissionsQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Table } from "@repo/ui/table";
import { Typography } from "@repo/ui/typography";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import {
  type FormError,
  formErrorOf,
} from "@/lib/base/form-engine/form-errors";

import { RetiredPermissionOutcome } from "./RetiredPermissionOutcome";

type RetiredPermission =
  RetiredFormPermissionsQuery["retiredFormPermissions"]["items"][number];

export interface RetiredPermissionsDialogProps {
  canDelete: boolean;
  onClose: () => void;
}

/**
 * 模組與權限 → 退役權限清理(根組織專屬)。列出 `dynamic` 且已退役的欄位級權限
 * (以 `name` 顯示表單名 / 欄位名)與使用狀況;刪除走 api 的三層檢查:
 * 草稿還在用 → 擋下並列出筆數與版本;只剩已完成 → 先警告「只有超級管理員看得到」,確認才刪;沒人用 → 直接刪。
 */
export const RetiredPermissionsDialog = ({
  canDelete,
  onClose,
}: RetiredPermissionsDialogProps) => {
  const t = useTranslations("admin.moduleManager.retired");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const showSnackbar = useSnackbar();
  const list = useRetiredFormPermissionsQuery(session.client);
  const remove = useDeleteRetiredPermissionMutation(session.client);
  const [target, setTarget] = useState<RetiredPermission | null>(null);
  const [error, setError] = useState<FormError | null>(null);

  const submit = async (permission: RetiredPermission, confirm: boolean) => {
    setTarget(permission);
    setError(null);
    try {
      await remove.mutateAsync({
        input: {
          permissionKey: permission.key,
          ...(confirm && { confirmCompletedUsage: true }),
        },
      });
      showSnackbar("success", t("deleted", { name: permission.name }));
      setTarget(null);
      await queryClient.invalidateQueries({
        queryKey: useRetiredFormPermissionsQuery.getKey(),
      });
    } catch (error_) {
      setError(formErrorOf(error_));
    }
  };

  const usageOf = (permission: RetiredPermission): string =>
    t("usage", {
      drafts: permission.usage.draftCount,
      completed: permission.usage.completedCount,
    });

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="md"
      title={t("title")}
      actions={
        <Button variant="text" onClick={onClose}>
          {t("close")}
        </Button>
      }
    >
      <Stack spacing={2}>
        <Typography variant="body2">{t("body")}</Typography>
        <Table<RetiredPermission>
          aria-label={t("tableAria")}
          size="small"
          rows={list.data?.retiredFormPermissions.items ?? []}
          getRowKey={(permission) => permission.key}
          isLoading={list.isLoading}
          emptyMessage={t("empty")}
          columns={[
            {
              key: "name",
              header: t("name"),
              render: (permission) => permission.name,
            },
            {
              key: "key",
              header: t("key"),
              render: (permission) => permission.key,
            },
            { key: "usage", header: t("usageHeader"), render: usageOf },
            {
              key: "actions",
              header: t("actions"),
              render: (permission) =>
                canDelete && (
                  <Button
                    size="small"
                    variant="text"
                    color="error"
                    aria-label={t("deleteOf", { name: permission.name })}
                    disabled={remove.isPending}
                    onClick={() => {
                      void submit(permission, false);
                    }}
                  >
                    {t("delete")}
                  </Button>
                ),
            },
          ]}
        />
        {target !== null && error !== null && (
          <RetiredPermissionOutcome
            permission={target}
            error={error}
            isPending={remove.isPending}
            onConfirm={() => {
              void submit(target, true);
            }}
            onCancel={() => {
              setTarget(null);
              setError(null);
            }}
          />
        )}
      </Stack>
    </Dialog>
  );
};
