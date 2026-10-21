import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import { useRevokeLotteryRedemptionMutation } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { ReasonFields } from "@/components/project/lottery/ReasonFields/ReasonFields";
import {
  EMPTY_REASON,
  type ReasonValue,
  missingReasonFields,
  reasonInputOf,
} from "@/components/project/lottery/ReasonFields/reason-value";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { redemptionErrorOf } from "@/lib/project/lottery/redemption-error";

import { moneyText } from "../store-text";
import {
  type RedemptionRow,
  invalidateRedemptions,
  redemptionErrorText,
  timeOnly,
} from "./redemption-shared";

/** 撤銷的 mutation(成功提示、重抓、錯誤標回欄位)。 */
const useRevoke = (
  onDone: () => void,
  onFields: (fields: string[]) => void,
) => {
  const t = useTranslations("admin.lotteryStore.redemption");
  const temporal = useTemporalText();
  const { session } = useSession();
  const queryClient = useQueryClient();
  return useRevokeLotteryRedemptionMutation(
    session.client,
    useMutationFeedback({
      success: t("revokeSuccess"),
      error: (error: unknown) =>
        redemptionErrorText(error, t, (value) =>
          temporal(value, "monthDayTime"),
        ),
      onSuccess: () => {
        invalidateRedemptions(queryClient);
        onDone();
      },
      onError: (error: unknown) => {
        onFields(redemptionErrorOf(error).fields ?? []);
      },
    }),
  );
};

export interface RevokeSelfDialogProps {
  row: RedemptionRow;
  onClose: () => void;
}

/**
 * 撤銷兌獎確認(自己登記、班還開著;不限時間、不用原因;規格 6.5、Figma ST-41):
 * 「撤銷兌獎? / 5164-056527-031 · 500 元 · 21:50 登記 / 撤銷後 500 元退回店內櫃台的抽屜應有金額」。
 */
export const RevokeSelfDialog = ({ row, onClose }: RevokeSelfDialogProps) => {
  const t = useTranslations("admin.lotteryStore.redemption");
  const temporal = useTemporalText();
  const revoke = useRevoke(onClose, () => {
    // 自己撤銷沒有欄位可標
  });
  const amount = moneyText(row.prizeAmount);
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("revokeTitle")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            color="error"
            disabled={revoke.isPending}
            onClick={() => {
              revoke.mutate({ input: { id: row.id } });
            }}
          >
            {t("revoke")}
          </Button>
        </>
      }
    >
      <Stack spacing={1}>
        <Typography color="text.primary">
          {t("revokeLine", {
            ticket: row.ticketLabel,
            amount,
            time: timeOnly(temporal(row.redeemedAt, "monthDayTime")),
          })}
        </Typography>
        <Typography variant="body2">
          {t("revokeHint", { amount, cashPoint: row.cashPoint.name })}
        </Typography>
      </Stack>
    </Dialog>
  );
};

export interface RevokeManagerDialogProps {
  row: RedemptionRow;
  onClose: () => void;
  /** [撤銷並重新登記]:原因填好了,接著開兌獎視窗(撤銷與新增在同一個請求) */
  onReplace: (reason: ReasonValue) => void;
}

/**
 * 撤銷兌獎(那一班已結帳、或不是自己登記的;`store.undo-redeem`;規格 6.5、Figma ST-39b):撤銷原因(必填)
 * + 說明;班開著 → 應有增加,已結帳 → 記成那一班的事後更正。[撤銷並重新登記] 接著開兌獎視窗。
 */
export const RevokeManagerDialog = ({
  row,
  onClose,
  onReplace,
}: RevokeManagerDialogProps) => {
  const t = useTranslations("admin.lotteryStore.redemption");
  const isMobile = useBreakpointDown("sm");
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  const [invalid, setInvalid] = useState<string[]>([]);
  const revoke = useRevoke(onClose, setInvalid);
  const amount = moneyText(row.prizeAmount);

  const check = (): boolean => {
    const missing = missingReasonFields(reason);
    setInvalid(missing);
    return missing.length === 0;
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={isMobile}
      title={t("managerTitle")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="outlined"
            disabled={revoke.isPending}
            onClick={() => {
              if (check()) {
                onReplace(reason);
              }
            }}
          >
            {t("replace")}
          </Button>
          <Button
            color="error"
            disabled={revoke.isPending}
            onClick={() => {
              if (check()) {
                revoke.mutate({
                  input: { id: row.id, ...reasonInputOf(reason) },
                });
              }
            }}
          >
            {t("revokeRedemption")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography color="text.primary">
          {t("managerSubtitle", { ticket: row.ticketLabel, amount })}
        </Typography>
        <ReasonFields
          categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.redemptionRevokeReason}
          label={t("reason")}
          value={reason}
          invalid={invalid}
          onChange={setReason}
        />
        <Alert severity="info">
          {row.shift.closed
            ? t("closedHint", { amount })
            : t("openHint", { amount, cashPoint: row.cashPoint.name })}
        </Alert>
        <Typography variant="body2">{t("replaceHint")}</Typography>
      </Stack>
    </Dialog>
  );
};
