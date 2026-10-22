import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  displayBookNo,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import {
  type LotteryInventoryBookDetailFieldsFragment,
  type LotteryInventoryTicketFieldsFragment,
  useScrapLotteryTicketsMutation,
} from "@repo/graphql";
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
import { inventoryErrorOf } from "@/lib/project/lottery/inventory-error";

import { moneyText } from "../inventory-config";

export interface ScrapTicketsDialogProps {
  detail: LotteryInventoryBookDetailFieldsFragment;
  tickets: readonly LotteryInventoryTicketFieldsFragment[];
  onClose: () => void;
  onScrapped: () => void;
}

/**
 * 報廢(Figma IN-04c 平板 573:110828 / 手機 573:111035;規格 7.4,`inventory.scrap`):
 * 只能報未售的張(破損、污損、受潮);原因必填(欄位管理「報廢原因」,選「其他」要填說明)。
 * 有 `show-cost` 時顯示損失(批購成本 = 單張成本 × 張數)。[報廢] 用錯誤色。手機全螢幕。
 */
export const ScrapTicketsDialog = ({
  detail,
  tickets,
  onClose,
  onScrapped,
}: ScrapTicketsDialogProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const { book, cost } = detail;
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  const [invalid, setInvalid] = useState<string[]>([]);
  const scrap = useScrapLotteryTicketsMutation(
    session.client,
    useMutationFeedback({
      success: t("scrap.success", { count: tickets.length }),
      error: (error) => t(`errors.${inventoryErrorOf(error).code}`),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: ["LotteryInventoryBook"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["LotteryInventoryBooks"],
        });
        onClose();
        onScrapped();
      },
      onError: (error) => {
        setInvalid(inventoryErrorOf(error).fields ?? []);
      },
    }),
  );
  const submit = () => {
    const missing = missingReasonFields(reason);
    setInvalid(missing);
    if (missing.length > 0) {
      return;
    }
    scrap.mutate({
      input: {
        tickets: tickets.map((ticket) => ({
          ticketId: ticket.id,
          version: ticket.version,
        })),
        ...reasonInputOf(reason),
      },
    });
  };
  const ranges = formatTicketRanges(tickets.map((ticket) => ticket.ticketNo));

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={
        <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
          <span>{t("scrap.title", { count: tickets.length })}</span>
          <Typography variant="body2" component="span">
            {book.gameCode} · {displayBookNo(book.bookNo)} · {ranges}
          </Typography>
        </Stack>
      }
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button color="error" disabled={scrap.isPending} onClick={submit}>
            {t("scrap.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <ReasonFields
          categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.scrapReason}
          label={t("scrap.reason")}
          value={reason}
          onChange={setReason}
          invalid={invalid}
        />
        {cost == null ? null : (
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="body2">{t("scrap.loss")}</Typography>
            <Typography variant="body1" color="error">
              {t("common.amount", {
                amount: moneyText(Math.round(cost.unitCost * tickets.length)),
              })}
            </Typography>
          </Stack>
        )}
      </Stack>
    </Dialog>
  );
};
