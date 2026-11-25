import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  displayBookNo,
  formatTicketRanges,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import {
  useFixLotteryOpeningTicketsMutation,
  useLotteryStoreOpeningQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
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

/** 改回未售放「庫存」的選項值(其他是收銀點 id)。 */
const STOCK = "stock";

/** 要更正的張(`version` 給 api 做條件更新)。 */
export interface OpeningFixTicket {
  id: string;
  version: number;
  ticketNo: string;
}

export interface OpeningFixDialogProps {
  /** 這本所在的分店(改回未售能放的收銀點) */
  orgId: string;
  book: { gameCode: string; bookNo: string };
  tickets: readonly OpeningFixTicket[];
  /** `unsold` 改回未售 / `opening_sold` 改成導入前已賣出 */
  to: "unsold" | "opening_sold";
  /** 改回未售預設放哪個收銀點(從刷條碼 / 重刷進來時 = 刷到的位置);沒有 = 庫存 */
  defaultCashPointId?: string | null;
  onClose: () => void;
  onFixed: () => void;
}

/**
 * 期初更正(Figma IN-04-5a / 5b;期初建檔規格 4.1、4.3,`inventory.opening`):[改回未售…] 選放哪個位置
 * (收銀點檯面或庫存;從刷條碼 / 重刷進來時預設刷到的位置)+ 原因;[改成導入前已賣出…] 只有原因(分店還在
 * 建檔才有這個按鈕)。原因必填(欄位管理「期初更正原因」,選「其他」要填說明)。不碰現金、不寫售出 / 撤銷。
 * 本的詳情、看板刷到期初已售、全店重刷共用。
 */
export const OpeningFixDialog = ({
  orgId,
  book,
  tickets,
  to,
  defaultCashPointId = null,
  onClose,
  onFixed,
}: OpeningFixDialogProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  const [place, setPlace] = useState(defaultCashPointId ?? STOCK);
  const [invalid, setInvalid] = useState<string[]>([]);
  const opening = useLotteryStoreOpeningQuery(
    session.client,
    { orgId },
    { enabled: to === "unsold" && orgId !== "", retry: false },
  );
  const cashPoints = opening.data?.lotteryStoreOpening.item.cashPoints ?? [];
  // 收銀點還沒讀到(或刷到的位置不在清單)→ 先顯示庫存;讀取中不能送出
  const chosen = cashPoints.some((point) => point.id === place)
    ? place
    : STOCK;
  const keys = to === "unsold" ? "openingFix.toUnsold" : "openingFix.toSold";
  const fix = useFixLotteryOpeningTicketsMutation(
    session.client,
    useMutationFeedback({
      success: t(`${keys}.success`, { count: tickets.length }),
      error: (error) => t(`errors.${inventoryErrorOf(error).code}`),
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: ["LotteryInventoryBook"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["LotteryInventoryBooks"],
        });
        onClose();
        onFixed();
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
    fix.mutate({
      input: {
        tickets: tickets.map((ticket) => ({
          ticketId: ticket.id,
          version: ticket.version,
        })),
        to,
        ...(to === "unsold" && {
          cashPointId: chosen === STOCK ? null : chosen,
        }),
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
          <span>{t(`${keys}.title`, { count: tickets.length })}</span>
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
          <Button
            disabled={fix.isPending || opening.isLoading}
            onClick={submit}
          >
            {t(`${keys}.submit`)}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">{t(`${keys}.hint`)}</Typography>
        {to === "unsold" ? (
          <SelectField
            label={t("openingFix.place")}
            value={chosen}
            size="small"
            fullWidth
            options={[
              ...cashPoints.map((point) => ({
                value: point.id,
                label: t("openingFix.counter", { name: point.name }),
              })),
              { value: STOCK, label: t("locations.stock") },
            ]}
            onChange={(value: string) => {
              setPlace(value);
            }}
          />
        ) : null}
        <ReasonFields
          categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.openingCorrectionReason}
          label={t("openingFix.reason")}
          value={reason}
          onChange={setReason}
          invalid={invalid}
        />
      </Stack>
    </Dialog>
  );
};
