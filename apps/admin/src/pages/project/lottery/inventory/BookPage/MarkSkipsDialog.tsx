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
  useMarkLotterySkippedTicketsMutation,
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

import { markSkipCellsOf } from "./book-cells";

export interface MarkSkipsDialogProps {
  detail: LotteryInventoryBookDetailFieldsFragment;
  onClose: () => void;
}

/**
 * 標跳號(規格 7.3,`inventory.mark-skipped`;使用者 10/27 定案 M1):這本還有待標註時(拆本時沒標,例:
 * 整本待查後只尋回幾張就上檯面),在格子點出不存在的號碼(1 ~ 待標註張數,只能選自己範圍內沒被鎖的未售張);
 * 原因必填(欄位管理「更正跳號原因」)。寫「跳號」事件。手機全螢幕。
 */
export const MarkSkipsDialog = ({ detail, onClose }: MarkSkipsDialogProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const { book } = detail;
  const pending = book.pendingSkipCount;
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  const [invalid, setInvalid] = useState<string[]>([]);
  const mark = useMarkLotterySkippedTicketsMutation(
    session.client,
    useMutationFeedback({
      success: t("markSkips.success"),
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
    if (selected.length === 0) {
      missing.push("tickets");
    }
    setInvalid(missing);
    if (missing.length > 0) {
      return;
    }
    mark.mutate({
      input: {
        bookId: book.id,
        tickets: detail.tickets
          .filter((ticket) => selected.includes(ticket.ticketNo))
          .map((ticket) => ({ ticketId: ticket.id, version: ticket.version })),
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
          <span>{t("markSkips.title")}</span>
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
          <Button disabled={mark.isPending} onClick={submit}>
            {t("markSkips.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">
          {t("markSkips.hint", { count: pending })}
        </Typography>
        <Typography
          variant="body1"
          color={invalid.includes("tickets") ? "warning" : "textPrimary"}
        >
          {t("markSkips.selected", {
            count: selected.length,
            total: pending,
            ranges: formatTicketRanges(selected) || t("stock.none"),
          })}
        </Typography>
        <TicketGrid
          cells={markSkipCellsOf(detail.tickets)}
          selectableStates={["unsold"]}
          selected={selected}
          onSelectedChange={setSelected}
          legendItems={["unsold", "skipped", "selected"]}
          quickSelect={false}
          maxSelected={pending}
          summary={false}
        />
        <ReasonFields
          categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.skipCorrectionReason}
          label={t("markSkips.reason")}
          value={reason}
          onChange={setReason}
          invalid={invalid}
        />
      </Stack>
    </Dialog>
  );
};
