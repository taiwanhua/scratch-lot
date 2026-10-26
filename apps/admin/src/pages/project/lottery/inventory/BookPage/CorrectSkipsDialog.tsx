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
  useCorrectLotterySkippedTicketsMutation,
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
import { TicketGrid } from "@/components/project/lottery/TicketGrid/TicketGrid";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { inventoryErrorOf } from "@/lib/project/lottery/inventory-error";

import { skipCorrectionCellsOf, skipCorrectionLegendOf } from "./book-cells";

export interface CorrectSkipsDialogProps {
  detail: LotteryInventoryBookDetailFieldsFragment;
  onClose: () => void;
}

/** 一行「標題 …… 值」。 */
const Line = ({ label, value }: { label: string; value: string }) => (
  <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
    <Typography variant="body2">{label}</Typography>
    <Typography variant="body1" color="textPrimary">
      {value}
    </Typography>
  </Stack>
);

/**
 * 更正跳號(Figma IN-04a 平板 182:15219 / 手機 182:15387;規格 7.3,`inventory.mark-skipped`):
 * 張數格子預選目前的跳號;改完的張數要等於待標註張數(迄號 − 標準張數);原因必填
 * (欄位管理「更正跳號原因」,選「其他」要填說明)。寫入「取消跳號」+「跳號」。手機全螢幕。
 */
export const CorrectSkipsDialog = ({
  detail,
  onClose,
}: CorrectSkipsDialogProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const { book } = detail;
  const required = book.requiredSkipCount;
  const [selected, setSelected] = useState<string[]>(book.skippedTicketNos);
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  const [invalid, setInvalid] = useState<string[]>([]);
  const correct = useCorrectLotterySkippedTicketsMutation(
    session.client,
    useMutationFeedback({
      success: t("correctSkips.success"),
      error: (error) => t(`errors.${inventoryErrorOf(error).code}`),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: ["LotteryInventoryBook"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["LotteryInventoryBooks"],
        });
        onClose();
      },
      onError: (error) => {
        setInvalid(inventoryErrorOf(error).fields ?? []);
      },
    }),
  );
  const submit = () => {
    const missing: string[] = missingReasonFields(reason);
    if (selected.length !== required) {
      missing.push("ticketNos");
    }
    setInvalid(missing);
    if (missing.length > 0) {
      return;
    }
    correct.mutate({
      input: {
        bookId: book.id,
        ticketNos: selected,
        ...reasonInputOf(reason),
      },
    });
  };
  const changedText = t("correctSkips.changedTo", {
    ranges: formatTicketRanges(selected) || t("stock.none"),
    count: selected.length,
    required,
  });

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <span>{t("correctSkips.title")}</span>
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
          <Button disabled={correct.isPending} onClick={submit}>
            {t("correctSkips.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Line
          label={t("correctSkips.required")}
          value={t("common.tickets", { count: required })}
        />
        <Line
          label={t("correctSkips.current")}
          value={formatTicketRanges(book.skippedTicketNos)}
        />
        <Stack direction="row" sx={{ justifyContent: "space-between", gap: 2 }}>
          <Typography variant="body2">{t("correctSkips.changed")}</Typography>
          <Typography
            variant="body1"
            color={
              invalid.includes("ticketNos") || selected.length !== required
                ? "warning"
                : "success"
            }
          >
            {changedText}
          </Typography>
        </Stack>
        <TicketGrid
          cells={skipCorrectionCellsOf(detail.tickets)}
          selectableStates={["unsold"]}
          selected={selected}
          onSelectedChange={setSelected}
          legendItems={skipCorrectionLegendOf(detail.tickets)}
          quickSelect={false}
          maxSelected={required}
          summary={false}
        />
        <ReasonFields
          categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.skipCorrectionReason}
          label={t("correctSkips.reason")}
          value={reason}
          onChange={setReason}
          invalid={invalid}
        />
        <Typography variant="caption">{t("correctSkips.hint")}</Typography>
      </Stack>
    </Dialog>
  );
};
