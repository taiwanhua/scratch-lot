import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

import {
  type UserDelegationFieldsFragment,
  useDeleteMyDelegationMutation,
  useMyDelegationsQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { delegationsErrorKey, delegationsErrorOf } from "./delegations-error";

export interface DeleteDelegationDialogProps {
  delegation: UserDelegationFieldsFragment;
  onClose: () => void;
}

/** 刪除未結束的代理的確認:已派給代理人的任務不會轉回來(派任只在進關那一次看代理)。 */
export const DeleteDelegationDialog = ({
  delegation,
  onClose,
}: DeleteDelegationDialogProps) => {
  const t = useTranslations("admin.personalSettings.delegations");
  const { session } = useSession();
  const queryClient = useQueryClient();

  const remove = useDeleteMyDelegationMutation(
    session.client,
    useMutationFeedback({
      success: t("deleted"),
      error: (error) =>
        t(`errors.${delegationsErrorKey(delegationsErrorOf(error))}`),
      onSuccess: () => {
        // DATA-04 (b):沒有單筆查詢可寫,清單各頁一次失效(getKey 第一段當前綴)
        void queryClient.invalidateQueries({
          queryKey: [useMyDelegationsQuery.getKey({ input: {} })[0]],
        });
        onClose();
      },
    }),
  );

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("deleteTitle", { name: delegation.delegate.name ?? "—" })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            color="error"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate({ input: { id: delegation.id } });
            }}
          >
            {t("deleteConfirm")}
          </Button>
        </>
      }
    >
      <Typography variant="body2">{t("deleteBody")}</Typography>
    </Dialog>
  );
};
