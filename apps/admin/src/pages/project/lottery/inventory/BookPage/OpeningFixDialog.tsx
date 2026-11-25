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
  useFixLotteryOpeningTicketsMutation,
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

export interface OpeningFixDialogProps {
  detail: LotteryInventoryBookDetailFieldsFragment;
  tickets: readonly LotteryInventoryTicketFieldsFragment[];
  /** `unsold` 改回未售 / `opening_sold` 改成導入前已賣出 */
  to: "unsold" | "opening_sold";
  /** 這家店的收銀點(改回未售放哪) */
  cashPoints: readonly { id: string; name: string }[];
  onClose: () => void;
  onFixed: () => void;
}

/**
 * 期初更正(Figma IN-04-5a / 5b;期初建檔規格 4.1,`inventory.opening`):[改回未售…] 選放哪個位置
 * (收銀點檯面或庫存)+ 原因;[改成導入前已賣出…] 只有原因(分店還在建檔才有這個按鈕)。原因必填
 * (欄位管理「期初更正原因」,選「其他」要填說明)。不碰現金、不寫售出 / 撤銷。
 */
export const OpeningFixDialog = ({
  detail,
  tickets,
  to,
  cashPoints,
  onClose,
  onFixed,
}: OpeningFixDialogProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  const [place, setPlace] = useState(STOCK);
  const [invalid, setInvalid] = useState<string[]>([]);
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
          cashPointId: place === STOCK ? null : place,
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
            {detail.book.gameCode} · {displayBookNo(detail.book.bookNo)} ·{" "}
            {ranges}
          </Typography>
        </Stack>
      }
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={fix.isPending} onClick={submit}>
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
            value={place}
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

/** 開著期初更正時才畫對話框(`to` 沒給 = 不畫;本的詳情頁用)。 */
export const OpeningFixDialogSlot = ({
  to,
  ...props
}: Omit<OpeningFixDialogProps, "to"> & {
  to: OpeningFixDialogProps["to"] | undefined;
}) => (to === undefined ? null : <OpeningFixDialog to={to} {...props} />);
