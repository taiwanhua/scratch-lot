import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryWholesaleCustomerFieldsFragment,
  useDeleteLotteryWholesaleCustomerMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Typography } from "@repo/ui/typography";

import { useCloseItemTabs } from "@/hooks/base/useCloseItemTabs";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { dealersErrorKey, dealersErrorOf } from "../dealers-error";
import type { DealersAccess } from "../useDealersAccess";
import { useInvalidateDealers } from "../useInvalidateDealers";

export interface DeleteWholesaleCustomerButtonProps {
  customer: LotteryWholesaleCustomerFieldsFragment;
  access: DealersAccess;
}

/**
 * 編輯頁動作列左側的 [刪除](Figma DE-11b):確認後刪除;被批售單引用時 api 擋下,
 * 提示「…已有批售單,不能刪除;不再往來請把狀態改成停用」(規格 21.2)。
 */
export const DeleteWholesaleCustomerButton = ({
  customer,
  access,
}: DeleteWholesaleCustomerButtonProps) => {
  const t = useTranslations("admin.lotteryDealers");
  const tErrors = useTranslations("admin.lotteryDealers.errors");
  const { session } = useSession();
  const closeItemTabs = useCloseItemTabs();
  const invalidate = useInvalidateDealers();
  const [isConfirming, setConfirming] = useState(false);
  const remove = useDeleteLotteryWholesaleCustomerMutation(
    session.client,
    useMutationFeedback({
      success: t("wholesale.feedback.deleteSuccess"),
      error: (error) =>
        tErrors(dealersErrorKey(dealersErrorOf(error)), {
          name: customer.storeName,
        }),
      onSuccess: () => {
        closeItemTabs({
          pageRoutes: [
            access.routes.wholesaleCustomerView,
            access.routes.wholesaleCustomerEdit,
          ],
          id: customer.id,
          listRoute: access.routes.list,
        });
        void invalidate();
      },
    }),
  );

  return (
    <>
      <Button
        variant="text"
        color="error"
        disabled={remove.isPending}
        onClick={() => {
          setConfirming(true);
        }}
      >
        {t("wholesale.delete.action")}
      </Button>
      {isConfirming && (
        <Dialog
          open
          maxWidth="xs"
          title={t("wholesale.delete.title")}
          onClose={() => {
            setConfirming(false);
          }}
          actions={
            <>
              <Button
                variant="text"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                color="error"
                onClick={() => {
                  setConfirming(false);
                  remove.mutate({ input: { id: customer.id } });
                }}
              >
                {t("wholesale.delete.action")}
              </Button>
            </>
          }
        >
          <Typography variant="body2">
            {t("wholesale.delete.body", { name: customer.storeName })}
          </Typography>
        </Dialog>
      )}
    </>
  );
};
