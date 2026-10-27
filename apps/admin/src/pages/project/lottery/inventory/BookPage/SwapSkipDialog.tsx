import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  TICKET_LOCATION_KIND,
  displayBookNo,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import {
  type LotteryInventoryBookDetailFieldsFragment,
  useSwapLotterySkippedTicketMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
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
import { inventoryErrorOf } from "@/lib/project/lottery/inventory-error";

type Detail = LotteryInventoryBookDetailFieldsFragment;
type Ticket = Detail["tickets"][number];

export interface SwapSkipDialogProps {
  detail: Detail;
  /** 改回未售的那張(目前是跳號,記在哪家店都可以) */
  skipped: Ticket;
  /** 改標跳號的那張(目前是未售,自己範圍內、未鎖定、不在途) */
  unsold: Ticket;
  onClose: () => void;
  onSwapped: () => void;
}

/**
 * 對調跳號(規格 7.3;使用者 10/26 定案做法 D,`inventory.mark-skipped`):寫出結果
 * (「047 跳號 → 未售,放到 信義店 · 收銀點 A 檯面」「048 未售 → 跳號」)、原因(欄位管理「更正跳號原因」,
 * 選「其他」要說明)、勾選「我已確認 047 的實體在我手上,048 實際不存在」才能 [對調]。
 * 改回未售的張接手配對那張的所在分店、位置、單張成本(api 照版本檢查;一次一對)。手機全螢幕。
 */
export const SwapSkipDialog = ({
  detail,
  skipped,
  unsold,
  onClose,
  onSwapped,
}: SwapSkipDialogProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const { book } = detail;
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [invalid, setInvalid] = useState<string[]>([]);
  const swap = useSwapLotterySkippedTicketMutation(
    session.client,
    useMutationFeedback({
      success: t("swapSkip.success"),
      error: (error) => t(`errors.${inventoryErrorOf(error).code}`),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: ["LotteryInventoryBook"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["LotteryInventoryBooks"],
        });
        onSwapped();
        onClose();
      },
      onError: (error) => {
        setInvalid(inventoryErrorOf(error).fields ?? []);
      },
    }),
  );
  const place =
    unsold.locationKind === TICKET_LOCATION_KIND.counter
      ? t("swapSkip.counter", {
          store: unsold.org.name,
          cashPoint: unsold.cashPoint?.name ?? "",
        })
      : t("swapSkip.stock", { store: unsold.org.name });
  const submit = () => {
    const missing = missingReasonFields(reason);
    setInvalid(missing);
    if (missing.length > 0 || !isConfirmed) {
      return;
    }
    swap.mutate({
      input: {
        bookId: book.id,
        skipped: { ticketId: skipped.id, version: skipped.version },
        unsold: { ticketId: unsold.id, version: unsold.version },
        ...reasonInputOf(reason),
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <span>{t("swapSkip.title")}</span>
          <Typography variant="body2" component="span">
            {book.gameCode} · {displayBookNo(book.bookNo)}
          </Typography>
        </Stack>
      }
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={swap.isPending || !isConfirmed} onClick={submit}>
            {t("swapSkip.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Stack spacing={0.5}>
          <Typography variant="body1" color="textPrimary">
            {t("swapSkip.toUnsold", { ticketNo: skipped.ticketNo, place })}
          </Typography>
          <Typography variant="body1" color="textPrimary">
            {t("swapSkip.toSkipped", { ticketNo: unsold.ticketNo })}
          </Typography>
        </Stack>
        <ReasonFields
          categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.skipCorrectionReason}
          label={t("swapSkip.reason")}
          value={reason}
          onChange={setReason}
          invalid={invalid}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={isConfirmed}
              onChange={(event) => {
                setIsConfirmed(event.target.checked);
              }}
            />
          }
          label={t("swapSkip.confirm", {
            skipped: skipped.ticketNo,
            unsold: unsold.ticketNo,
          })}
        />
        <Typography variant="caption">{t("swapSkip.hint")}</Typography>
      </Stack>
    </Dialog>
  );
};
