import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  INVENTORY_SKIP_CORRECTION_SCAN_PURPOSE,
  TICKET_LOCATION_KIND,
  displayBookNo,
  normalizeBookNo,
  parseTicketInput,
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
import { TextField } from "@repo/ui/text-field";
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
import { useScanner } from "@/hooks/base/useScanner/useScanner";
import { useSession } from "@/hooks/base/useSession";
import { inventoryErrorOf } from "@/lib/project/lottery/inventory-error";

import {
  correctionCellsOf,
  correctionLegendOf,
  isCorrectionTarget,
} from "./book-cells";

type Detail = LotteryInventoryBookDetailFieldsFragment;
type Ticket = Detail["tickets"][number];

export interface SkipCorrectionDialogProps {
  detail: Detail;
  onClose: () => void;
}

/**
 * [更正跳號](張數店規格 7.10,兩種店共用;使用者 11/02 定,Figma IN-04-3a / 3b;`inventory.mark-skipped`):
 * ① 先刷或手輸實體在手上、系統記為跳號的那張(刷到的不是記為跳號的張 → 輸入框下方當下說明,[更正] 停用);
 * ② 再在格子點手上沒有、要改記跳號的那張(未售;張數店另可選系統預設帶入的已售 / 待查 / 遺失·未對號,
 * 送出時先把這個狀態移給同位置一張未售);寫出結果、原因必填、勾選確認後 [更正]。
 * 跳號那張接手另一張的所在分店、位置與單張成本(api 照版本檢查;一次一對)。開著時宣告掃描用途
 * `inventory-skip-correction`。手機全螢幕。
 */
export const SkipCorrectionDialog = ({
  detail,
  onClose,
}: SkipCorrectionDialogProps) => {
  const t = useTranslations("admin.lotteryInventory");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const { book } = detail;
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Ticket | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [invalid, setInvalid] = useState<string[]>([]);
  const target =
    detail.tickets.find(
      (ticket) =>
        picked.includes(ticket.ticketNo) && isCorrectionTarget(ticket),
    ) ?? null;

  /** 刷到或手輸的張:要是這一本、記為跳號的張。 */
  const scan = (raw: string) => {
    const parsed = parseTicketInput(raw);
    const bookNo = parsed === null ? null : normalizeBookNo(parsed.bookNo);
    const ticket =
      parsed === null || bookNo !== book.bookNo
        ? undefined
        : detail.tickets.find((one) => one.ticketNo === parsed.ticketNo);
    if (ticket === undefined) {
      setSkipped(null);
      setCodeError(
        parsed === null
          ? t("skipCorrection.codeInvalid")
          : t("skipCorrection.notThisBook"),
      );
      return;
    }
    if (ticket.status !== "skipped") {
      setSkipped(null);
      setCodeError(
        t("skipCorrection.notSkipped", {
          ticketNo: ticket.ticketNo,
          status: t(`ticketStatuses.${ticket.status}`),
        }),
      );
      return;
    }
    setSkipped(ticket);
    setCodeError(null);
  };
  useScanner(INVENTORY_SKIP_CORRECTION_SCAN_PURPOSE, ({ code: value }) => {
    setCode(value);
    scan(value);
  });

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
        onClose();
      },
      onError: (error) => {
        setInvalid(inventoryErrorOf(error).fields ?? []);
      },
    }),
  );
  const ready = skipped !== null && target !== null && isConfirmed;
  const submit = () => {
    const missing = missingReasonFields(reason);
    setInvalid(missing);
    if (missing.length > 0 || skipped === null || target === null) {
      return;
    }
    swap.mutate({
      input: {
        bookId: book.id,
        skipped: { ticketId: skipped.id, version: skipped.version },
        unsold: { ticketId: target.id, version: target.version },
        scanned: true,
        ...reasonInputOf(reason),
      },
    });
  };
  const placeOf = (ticket: Ticket): string =>
    ticket.locationKind === TICKET_LOCATION_KIND.counter
      ? t("swapSkip.counter", {
          store: ticket.org.name,
          cashPoint: ticket.cashPoint?.name ?? "",
        })
      : t("swapSkip.stock", { store: ticket.org.name });

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
          <Button disabled={swap.isPending || !ready} onClick={submit}>
            {t("swapSkip.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label={t("skipCorrection.scan")}
          slotProps={{
            htmlInput: {
              "data-scanner-field": INVENTORY_SKIP_CORRECTION_SCAN_PURPOSE,
            },
          }}
          size="small"
          value={code}
          error={codeError !== null}
          helperText={codeError ?? undefined}
          onChange={(event) => {
            setCode(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              scan(code);
            }
          }}
          onBlur={() => {
            if (code.trim() !== "") {
              scan(code);
            }
          }}
        />
        {skipped === null ? null : (
          <>
            <Typography variant="body2" color="textSecondary">
              {t("skipCorrection.pick")}
            </Typography>
            <TicketGrid
              cells={correctionCellsOf(detail.tickets)}
              selectableStates={["unsold", "unmatchedSold", "unmatchedLost"]}
              selected={picked}
              onSelectedChange={(next) => {
                // 一次一張:點新的那張取代舊的
                setPicked(next.filter((no) => !picked.includes(no)).slice(-1));
              }}
              legendItems={correctionLegendOf(detail.tickets)}
              quickSelect={false}
              summary={false}
            />
            {target === null ? null : (
              <Stack spacing={0.5}>
                <Typography variant="body1" color="textPrimary">
                  {t("swapSkip.toUnsold", {
                    ticketNo: skipped.ticketNo,
                    place: placeOf(target),
                  })}
                </Typography>
                <Typography variant="body1" color="textPrimary">
                  {target.unmatched
                    ? t("skipCorrection.guessedToSkipped", {
                        ticketNo: target.ticketNo,
                        status: t(`ticketStatuses.${target.status}`),
                      })
                    : t("swapSkip.toSkipped", { ticketNo: target.ticketNo })}
                </Typography>
              </Stack>
            )}
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
                unsold: target?.ticketNo ?? "—",
              })}
            />
          </>
        )}
        <Typography variant="caption">{t("swapSkip.hint")}</Typography>
      </Stack>
    </Dialog>
  );
};
