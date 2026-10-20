import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  displayBookNo,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import { useRecoverLotteryTicketsMutation } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { inventoryErrorOf } from "@/lib/project/lottery/inventory-error";

import { ReasonFields } from "../ReasonFields/ReasonFields";
import {
  EMPTY_REASON,
  type ReasonValue,
  missingReasonFields,
  reasonInputOf,
} from "../ReasonFields/reason-value";

/** 要尋回的一張:id、讀到的版本(條件更新)、張號、狀態(`investigating` / `lost`)。 */
export interface RecoverTicket {
  id: string;
  version: number;
  ticketNo: string;
  status: string;
}

export interface RecoverTicketDialogProps {
  /** 這本:遊戲代號、名稱、面額、本號(7 位) */
  book: {
    gameCode: string;
    gameName: string;
    unitPrice: number;
    bookNo: string;
  };
  tickets: readonly RecoverTicket[];
  /** 回到哪家店(刷到的那家店;本的詳情頁、待查·遺失分頁 = 目前組織) */
  store: { id: string; name: string };
  onClose: () => void;
  /** 尋回成功(對話框已關閉;呼叫端重讀自己的資料) */
  onRecovered?: () => void;
}

/** 尋回後要重讀的查詢(codegen 的 query key 第一段是 operation 名稱)。 */
const REFRESH_KEYS = [
  "LotteryInventoryBook",
  "LotteryInventoryBooks",
  "LotteryInvestigations",
  "LotteryTicketLookup",
];

/**
 * 尋回(Figma IN-04b;規格 7.4,`inventory.recover`):待查 / 遺失的張回到 `store` 的庫存,
 * 原因必填(欄位管理「尋回原因」,選「其他」要填說明)。本的詳情頁、待查·遺失分頁、
 * 店面刷到待查或遺失的張(看板)共用。手機全螢幕。
 */
export const RecoverTicketDialog = ({
  book,
  tickets,
  store,
  onClose,
  onRecovered,
}: RecoverTicketDialogProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  const [invalid, setInvalid] = useState<string[]>([]);
  const recover = useRecoverLotteryTicketsMutation(
    session.client,
    useMutationFeedback({
      success: t("recover.success", { count: tickets.length }),
      error: (error) => t(`errors.${inventoryErrorOf(error).code}`),
      onSuccess: () => {
        for (const key of REFRESH_KEYS) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
        onClose();
        onRecovered?.();
      },
      onError: (error) => {
        setInvalid(inventoryErrorOf(error).fields ?? []);
      },
    }),
  );
  const statuses = [...new Set(tickets.map((ticket) => ticket.status))];
  const submit = () => {
    const missing = missingReasonFields(reason);
    setInvalid(missing);
    if (missing.length > 0) {
      return;
    }
    recover.mutate({
      input: {
        tickets: tickets.map((ticket) => ({
          ticketId: ticket.id,
          version: ticket.version,
        })),
        orgId: store.id,
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
      title={t("recover.title", { count: tickets.length })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={recover.isPending} onClick={submit}>
            {t("recover.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Box sx={{ bgcolor: "action.hover", borderRadius: 1, p: 1.5 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between" }}>
            <Typography variant="subtitle1" color="text.primary">
              {book.gameCode} {book.gameName}
            </Typography>
            <Typography variant="body2">
              {t("common.unitPrice", {
                price: book.unitPrice.toLocaleString("en-US"),
              })}
            </Typography>
          </Stack>
          <Typography variant="body2">
            {t("recover.ticketLine", {
              bookNo: displayBookNo(book.bookNo),
              ranges: formatTicketRanges(
                tickets.map((ticket) => ticket.ticketNo),
              ),
              statuses: statuses
                .map((status) => t(`ticketStatuses.${status}`))
                .join("、"),
            })}
          </Typography>
        </Box>
        <ReasonFields
          categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.recoverReason}
          label={t("recover.reason")}
          value={reason}
          onChange={setReason}
          invalid={invalid}
        />
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Typography variant="body2">{t("recover.backTo")}</Typography>
          <Typography variant="body1" color="text.primary">
            {t("recover.backToStore", { store: store.name })}
          </Typography>
        </Stack>
      </Stack>
    </Dialog>
  );
};
