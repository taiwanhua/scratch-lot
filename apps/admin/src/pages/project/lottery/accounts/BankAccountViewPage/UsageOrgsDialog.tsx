import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryBankAccountFieldsFragment,
  useUpdateLotteryBankAccountMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  type ShareOrgValue,
  ShareOrgsField,
} from "@/components/base/ShareOrgsField/ShareOrgsField";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { accountsErrorOf } from "@/lib/project/lottery/accounts-error";

import { useInvalidateAccounts } from "../useInvalidateAccounts";

export interface UsageOrgsDialogProps {
  account: LotteryBankAccountFieldsFragment;
  onClose: () => void;
}

/** 設定使用組織(帳戶詳情 [設定使用組織]):整份清單一次送;選最上層組織並勾含下層 = 全部分店。 */
export const UsageOrgsDialog = ({ account, onClose }: UsageOrgsDialogProps) => {
  const t = useTranslations("admin.lotteryAccounts");
  const { session } = useSession();
  const isMobile = useBreakpointDown("sm");
  const invalidate = useInvalidateAccounts();
  const [value, setValue] = useState<ShareOrgValue[]>(() =>
    account.shareOrgs.map((entry) => ({
      orgId: entry.orgId,
      includeDescendants: entry.includeDescendants,
    })),
  );
  const update = useUpdateLotteryBankAccountMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.saveSuccess"),
      error: (error: unknown) => t(`errors.${accountsErrorOf(error).code}`),
      onSuccess: () => {
        invalidate();
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
      fullScreen={isMobile}
      title={t("accountView.usageDialog.title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("accountView.usageDialog.cancel")}
          </Button>
          <Button
            disabled={update.isPending}
            onClick={() => {
              update.mutate({ input: { id: account.id, shareOrgs: value } });
            }}
          >
            {t("accountView.usageDialog.save")}
          </Button>
        </>
      }
    >
      <Stack spacing={1.5} sx={{ pt: 1 }}>
        <ShareOrgsField
          label={t("accountForm.fields.shareOrgs")}
          value={value}
          onChange={setValue}
        />
        <Typography variant="caption" color="textSecondary">
          {t("accountView.usageDialog.hint")}
        </Typography>
      </Stack>
    </Dialog>
  );
};
