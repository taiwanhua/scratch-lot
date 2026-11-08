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
  useUndoLotteryScrapMutation,
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

export interface UndoScrapDialogProps {
  detail: LotteryInventoryBookDetailFieldsFragment;
  tickets: readonly LotteryInventoryTicketFieldsFragment[];
  onClose: () => void;
  onUndone: () => void;
}

/**
 * 撤銷報廢(張數店規格 7.8,兩種店;Figma IN-04-2b;`inventory.scrap`):報錯張時先撤銷報廢,張回到未售、
 * 位置不變。原因必填(欄位管理「撤銷報廢原因」,選「其他」要填說明);有 `show-cost` 時寫扣回的報廢損失。
 * 報廢的票不會退回彩券公司,沒有時限。手機全螢幕。
 */
export const UndoScrapDialog = ({
  detail,
  tickets,
  onClose,
  onUndone,
}: UndoScrapDialogProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const { book, cost } = detail;
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  const [invalid, setInvalid] = useState<string[]>([]);
  const undo = useUndoLotteryScrapMutation(
    session.client,
    useMutationFeedback({
      success: t("undoScrap.success", { count: tickets.length }),
      error: (error) => t(`errors.${inventoryErrorOf(error).code}`),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: ["LotteryInventoryBook"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["LotteryInventoryBooks"],
        });
        onClose();
        onUndone();
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
    undo.mutate({
      input: {
        tickets: tickets.map((ticket) => ({
          ticketId: ticket.id,
          version: ticket.version,
        })),
        ...reasonInputOf(reason),
      },
    });
  };
  const first = tickets.at(0);
  const place =
    first?.cashPoint == null
      ? t("undoScrap.stock", { store: first?.org.name ?? "" })
      : t("undoScrap.counter", {
          store: first.org.name,
          cashPoint: first.cashPoint.name,
        });

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="xs"
      title={
        <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
          <span>{t("undoScrap.title", { count: tickets.length })}</span>
          <Typography variant="body2" component="span">
            {book.gameCode} · {displayBookNo(book.bookNo)} ·{" "}
            {formatTicketRanges(tickets.map((ticket) => ticket.ticketNo))}
          </Typography>
        </Stack>
      }
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={undo.isPending} onClick={submit}>
            {t("undoScrap.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <ReasonFields
          categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.scrapUndoReason}
          label={t("undoScrap.reason")}
          value={reason}
          onChange={setReason}
          invalid={invalid}
        />
        {cost == null ? null : (
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="body2">{t("undoScrap.recovered")}</Typography>
            <Typography variant="body1" color="error">
              {t("common.amount", {
                amount: moneyText(Math.round(cost.unitCost * tickets.length)),
              })}
            </Typography>
          </Stack>
        )}
        <Typography variant="body2" color="textSecondary">
          {t("undoScrap.hint", { place })}
        </Typography>
      </Stack>
    </Dialog>
  );
};
