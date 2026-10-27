import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryBankAccountFieldsFragment,
  useDeleteLotteryBankAccountMutation,
  useUpdateLotteryBankAccountMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Tooltip } from "@repo/ui/tooltip";
import { Typography } from "@repo/ui/typography";

import { useCloseItemTabs } from "@/hooks/base/useCloseItemTabs";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { accountsErrorOf } from "@/lib/project/lottery/accounts-error";

import { useInvalidateAccounts } from "../useInvalidateAccounts";

export interface AccountStatusActionsProps {
  account: LotteryBankAccountFieldsFragment;
  /** 列表頁的路由(刪除後回去) */
  listRoute: string | null;
  /** 詳情頁的路由(刪除後關掉這一筆的頁籤) */
  viewRoute: string | null;
}

/**
 * 帳戶詳情頂部列的 [停用帳戶 / 重新啟用] 與 [刪除帳戶](text;停用、刪除是 error 色,REACT-16)。
 * 要 `abilities.canEdit`(由頁面決定掛不掛);[刪除帳戶] 只有沒有交易時能按,有交易只能停用(提示原因)。
 */
export const AccountStatusActions = ({
  account,
  listRoute,
  viewRoute,
}: AccountStatusActionsProps) => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const closeItemTabs = useCloseItemTabs();
  const invalidate = useInvalidateAccounts();
  const [isConfirmingDelete, setConfirmingDelete] = useState(false);
  const isActive = account.status === "active";

  const feedbackError = (error: unknown) =>
    t(`errors.${accountsErrorOf(error).code}`);
  const update = useUpdateLotteryBankAccountMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.saveSuccess"),
      error: feedbackError,
      onSuccess: invalidate,
    }),
  );
  const remove = useDeleteLotteryBankAccountMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.deleteSuccess"),
      error: feedbackError,
      onSuccess: () => {
        invalidate();
        closeItemTabs({ pageRoutes: [viewRoute], id: account.id, listRoute });
      },
    }),
  );

  return (
    <>
      <Button
        variant="text"
        color={isActive ? "error" : "primary"}
        disabled={update.isPending}
        onClick={() => {
          update.mutate({
            input: {
              id: account.id,
              status: isActive ? "inactive" : "active",
            },
          });
        }}
      >
        {isActive ? t("accountView.deactivate") : t("accountView.activate")}
      </Button>
      <Tooltip
        title={account.hasTransactions ? t("accountView.deleteHint") : ""}
      >
        <Button
          variant="text"
          color="error"
          disabled={!account.abilities.canDelete}
          onClick={() => {
            setConfirmingDelete(true);
          }}
        >
          {t("accountView.delete")}
        </Button>
      </Tooltip>
      {isConfirmingDelete && (
        <Dialog
          open
          onClose={() => {
            setConfirmingDelete(false);
          }}
          maxWidth="xs"
          title={t("accountView.deleteDialog.title")}
          actions={
            <>
              <Button
                variant="text"
                onClick={() => {
                  setConfirmingDelete(false);
                }}
              >
                {t("accountView.deleteDialog.cancel")}
              </Button>
              <Button
                color="error"
                disabled={remove.isPending}
                onClick={() => {
                  setConfirmingDelete(false);
                  remove.mutate({ id: account.id });
                }}
              >
                {t("accountView.deleteDialog.confirm")}
              </Button>
            </>
          }
        >
          <Typography variant="body2">
            {t("accountView.deleteDialog.body", { label: account.label })}
          </Typography>
        </Dialog>
      )}
    </>
  );
};
