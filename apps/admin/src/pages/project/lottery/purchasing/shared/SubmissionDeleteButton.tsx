import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  FormSubmissionStatus,
  useDeleteFormSubmissionMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";

import { DeleteSubmissionDialog } from "@/components/base/form-engine/FormModulePages/DeleteSubmissionDialog";
import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useCloseItemTabs } from "@/hooks/base/useCloseItemTabs";
import { useFormSubmissionCache } from "@/hooks/base/useFormSubmissionCache";
import { useSession } from "@/hooks/base/useSession";
import {
  type FormError,
  formErrorOf,
} from "@/lib/base/form-engine/form-errors";

export interface SubmissionDeleteButtonProps {
  moduleKey: string;
  /** 提交 id */
  id: string;
  /** 確認句裡的名稱(例 單號) */
  label: string;
  /** 單據狀態:只有草稿出現 [刪除](api 的 `beforeDelete` 也擋非草稿) */
  status: FormSubmissionStatus;
  /** api 的 `abilities.canDelete`(已含權限與引擎規則);false = 不出現 */
  canDelete: boolean;
}

/**
 * 進貨單 / 調貨單自訂列表與檢視頁的 [刪除](規格 8 共通「草稿」;使用者 10/26 定案):**只限草稿**,而且照引擎的
 * `abilities.canDelete`(送出過的單有鎖定 / 收付 / 叫貨單引用,刪了不會釋放,api 的 `beforeDelete` 也擋)出現,確認與刪除沿用底座的表單刪除(`DeleteSubmissionDialog` + `deleteFormSubmission`,api 再擋一次);
 * 刪除後重抓列表、關掉那一筆的詳情 / 編輯頁籤(在詳情頁刪 → 回列表)。點按鈕不觸發列表的整列點擊。
 */
export const SubmissionDeleteButton = ({
  moduleKey,
  id,
  label,
  status,
  canDelete,
}: SubmissionDeleteButtonProps) => {
  const t = useTranslations("admin.formEngine.pages");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const access = useFormModuleAccess(moduleKey);
  const updateCache = useFormSubmissionCache();
  const closeItemTabs = useCloseItemTabs();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const deletion = useDeleteFormSubmissionMutation(session.client, {
    onSuccess: () => {
      updateCache(null);
      void queryClient.invalidateQueries();
      setIsOpen(false);
      closeItemTabs({
        pageRoutes: [access.viewRoute, access.editRoute],
        id,
        listRoute: access.listRoute,
      });
    },
    onError: (failure) => {
      setError(formErrorOf(failure));
    },
  });
  if (!canDelete || status !== FormSubmissionStatus.Draft) {
    return null;
  }

  return (
    // 彈窗經 portal 仍沿 React 樹冒泡:擋在這裡,列表的整列點擊才不會跟著觸發
    <Box
      component="span"
      role="presentation"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <Button
        variant="text"
        size="small"
        color="error"
        aria-label={t("deleteOf", { label })}
        onClick={() => {
          setError(null);
          setIsOpen(true);
        }}
      >
        {t("delete")}
      </Button>
      {isOpen && (
        <DeleteSubmissionDialog
          label={label}
          isSubmitting={deletion.isPending}
          error={error}
          onCancel={() => {
            setIsOpen(false);
          }}
          onConfirm={() => {
            deletion.mutate({ input: { id } });
          }}
        />
      )}
    </Box>
  );
};
