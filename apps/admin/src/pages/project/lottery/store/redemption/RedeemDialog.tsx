import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  REDEMPTION_PRIZE_PRESETS,
  displayBookNo,
} from "@repo/domain/project/lottery";
import {
  type LotteryRedemptionPreviewQuery,
  useLotteryRedemptionPreviewQuery,
  useRedeemLotteryTicketMutation,
  useReplaceLotteryRedemptionMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import {
  type ReasonValue,
  reasonInputOf,
} from "@/components/project/lottery/ReasonFields/reason-value";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { moneyText } from "../store-text";
import {
  type RedemptionRow,
  invalidateRedemptions,
  prizeStateOf,
  redemptionErrorText,
} from "./redemption-shared";

type PreviewItem = NonNullable<
  LotteryRedemptionPreviewQuery["lotteryRedemptionPreview"]["item"]
>;

/** 刷到的那一張:遊戲、面額、本號、張號、是不是本店的刮刮樂。 */
const PreviewCard = ({ item }: { item: PreviewItem }) => {
  const t = useTranslations("admin.lotteryStore.redemption");
  return (
    <Box sx={{ bgcolor: "grey.50", borderRadius: 2, px: 2, py: 1.5 }}>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "baseline" }}
      >
        <Typography variant="subtitle1" color="text.primary">
          {item.gameName == null
            ? item.gameCode
            : `${item.gameCode} ${item.gameName}`}
        </Typography>
        {item.unitPrice == null ? null : (
          <Typography variant="body2" color="text.secondary">
            {t("money", { amount: moneyText(item.unitPrice) })}
          </Typography>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {t("previewMeta", {
          bookNo: displayBookNo(item.bookNo),
          ticketNo: item.ticketNo,
          source: item.isOwnStore ? t("own") : t("other"),
        })}
      </Typography>
    </Box>
  );
};

export interface RedeemDialogProps {
  /** 看的那家店(預覽「是不是本店的刮刮樂」) */
  orgId: string;
  /** 錢從哪一班的抽屜付出 */
  shiftId: string;
  cashPointName: string;
  /** 抽屜目前的應有現金;那一班已結帳([撤銷並重新登記])= null(不檢查) */
  expectedCash: number | null;
  /** [撤銷並重新登記]:原紀錄與撤銷原因(撤銷 + 新增在同一個請求) */
  replace?: { original: RedemptionRow; reason: ReasonValue } | null;
  onClose: () => void;
  /** 兌獎 / 重新登記成功(新的那一筆) */
  onDone: (row: RedemptionRow) => void;
}

/**
 * 兌獎視窗(專案規格 6.5;Figma ST-11a / ST-11b):刷背面編號 → 顯示遊戲、本號、張號、是不是本店的刮刮樂、
 * 已兌過的提示;常見金額 + 自由輸入。單張超過 5,000、超過抽屜應有在畫面先擋(api 再擋一次)。
 * [撤銷並重新登記] 也用這個視窗(標題「重新登記」,送出時一起撤銷原紀錄)。
 */
export const RedeemDialog = ({
  orgId,
  shiftId,
  cashPointName,
  expectedCash,
  replace = null,
  onClose,
  onDone,
}: RedeemDialogProps) => {
  const t = useTranslations("admin.lotteryStore.redemption");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const temporal = useTemporalText();
  const [code, setCode] = useState("");
  const [lookedUp, setLookedUp] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<unknown>(null);

  const preview = useLotteryRedemptionPreviewQuery(
    session.client,
    { input: { orgId, code: lookedUp } },
    { enabled: lookedUp !== "", retry: false },
  );
  const item = preview.data?.lotteryRedemptionPreview.item ?? null;

  const done = (row: RedemptionRow) => {
    invalidateRedemptions(queryClient);
    onDone(row);
  };
  const redeem = useRedeemLotteryTicketMutation(session.client, {
    onSuccess: (data) => {
      done(data.redeemLotteryTicket.item);
    },
    onError: setError,
  });
  const replaceMutation = useReplaceLotteryRedemptionMutation(session.client, {
    onSuccess: (data) => {
      done(data.replaceLotteryRedemption.item);
    },
    onError: setError,
  });
  const isPending = redeem.isPending || replaceMutation.isPending;

  const {
    value: amountValue,
    isValid: isAmountValid,
    problem,
  } = prizeStateOf(amount, expectedCash);
  const amountProblem =
    problem === null
      ? null
      : t(problem, { expected: moneyText(expectedCash ?? 0) });
  const existing = item?.existing ?? null;
  const replacingSame =
    replace !== null &&
    item !== null &&
    item.ticketLabel === replace.original.ticketLabel;
  const isBlocked = existing !== null && !replacingSame;

  const errorSource = error ?? (preview.isError ? preview.error : null);
  const errorText =
    errorSource === null
      ? null
      : redemptionErrorText(errorSource, t, (value) =>
          temporal(value, "monthDayTime"),
        );

  const canSubmit =
    !isPending &&
    !isBlocked &&
    code.trim() !== "" &&
    isAmountValid &&
    amountProblem === null;

  const lookUp = () => {
    setError(null);
    setLookedUp(code.trim());
  };
  const submit = () => {
    setError(null);
    if (!canSubmit) {
      return;
    }
    if (replace === null) {
      redeem.mutate({
        input: { shiftId, code: code.trim(), prizeAmount: amountValue },
      });
      return;
    }
    replaceMutation.mutate({
      input: {
        id: replace.original.id,
        ...reasonInputOf(replace.reason),
        code: code.trim(),
        prizeAmount: amountValue,
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      fullScreen={isMobile}
      title={
        replace === null
          ? t("redeemTitle", { name: cashPointName })
          : t("replaceTitle", { name: cashPointName })
      }
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {replace === null ? t("confirm") : t("replace")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label={t("code")}
          value={code}
          helperText={t("codeHint")}
          onChange={(event) => {
            setCode(event.target.value);
          }}
          onBlur={lookUp}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              lookUp();
            }
          }}
        />
        {item === null ? null : <PreviewCard item={item} />}
        {isBlocked ? (
          <Alert severity="error">
            {t("existing", {
              time: temporal(existing.redeemedAt, "monthDayTime"),
              cashPoint: existing.cashPointName,
            })}
          </Alert>
        ) : null}
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
          {REDEMPTION_PRIZE_PRESETS.map((preset) => (
            <Button
              key={preset}
              size="small"
              variant={amountValue === preset ? "contained" : "outlined"}
              onClick={() => {
                setAmount(String(preset));
              }}
            >
              {moneyText(preset)}
            </Button>
          ))}
        </Stack>
        <TextField
          label={t("prize")}
          value={amount}
          required
          error={amountProblem !== null}
          helperText={amountProblem ?? undefined}
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
        {errorText === null ? null : (
          <Alert severity="error">{errorText}</Alert>
        )}
        <Alert severity="info">
          {t("rule", {
            expected: expectedCash === null ? "—" : moneyText(expectedCash),
          })}
        </Alert>
      </Stack>
    </Dialog>
  );
};
