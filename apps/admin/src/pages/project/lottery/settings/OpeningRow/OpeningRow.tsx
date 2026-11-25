import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "@repo/domain/form";
import {
  type LotteryStoreOpeningFieldsFragment,
  useCloseLotteryStoreOpeningMutation,
  useLotteryStoreOpeningQuery,
  useReopenLotteryStoreOpeningMutation,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";

import { lotterySettingsErrorOf } from "../lottery-settings-error";

export interface OpeningRowProps {
  orgId: string;
}

type Opening = LotteryStoreOpeningFieldsFragment;

/**
 * 刮刮樂設定選到分店時的「期初建檔」一列(Figma CS-50a-x;期初建檔規格 2.4、6):進行中(已建 N 本)+
 * [結束期初建檔] / 已結束(日期 誰)+ [重新開放]。按鈕只給有 `lottery-settings.edit-org` 的人(`canClose`);
 * 店長只能看。讀不到(沒有 `inventory.opening` 也沒有 `edit-org`)就不顯示這一列。
 */
export const OpeningRow = ({ orgId }: OpeningRowProps) => {
  const t = useTranslations("admin.lotterySettings.opening");
  const tFeedback = useTranslations("admin.lotterySettings.feedback");
  const tErrors = useTranslations("admin.lotterySettings.errors");
  const { session } = useSession();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const queryClient = useQueryClient();
  const variables = { orgId };
  const query = useLotteryStoreOpeningQuery(session.client, variables, {
    retry: false,
  });
  const [dialog, setDialog] = useState<"close" | "reopen" | null>(null);
  const write = (next: Opening) => {
    queryClient.setQueryData(useLotteryStoreOpeningQuery.getKey(variables), {
      lotteryStoreOpening: { item: next },
    });
    setDialog(null);
  };
  const error = (cause: unknown) => tErrors(lotterySettingsErrorOf(cause).code);
  const close = useCloseLotteryStoreOpeningMutation(
    session.client,
    useMutationFeedback({
      success: tFeedback("closeOpeningSuccess"),
      error,
      onSuccess: (data) => {
        write(data.closeLotteryStoreOpening.item);
      },
    }),
  );
  const reopen = useReopenLotteryStoreOpeningMutation(
    session.client,
    useMutationFeedback({
      success: tFeedback("reopenOpeningSuccess"),
      error,
      onSuccess: (data) => {
        write(data.reopenLotteryStoreOpening.item);
      },
    }),
  );
  const opening = query.data?.lotteryStoreOpening.item;
  if (opening === undefined) {
    return null;
  }
  const isPending = close.isPending || reopen.isPending;
  const value = opening.closed
    ? t("closed", {
        at:
          opening.closedAt === null
            ? ""
            : formatTemporal(opening.closedAt, { type: "monthDay", timezone }),
        by: opening.closedBy?.name ?? "",
      })
    : t("open", { count: opening.bookCount });

  let action = null;
  if (opening.canClose) {
    action = (
      <Button
        variant="outlined"
        size="small"
        disabled={isPending}
        onClick={() => {
          setDialog(opening.closed ? "reopen" : "close");
        }}
      >
        {opening.closed ? t("reopen") : t("close")}
      </Button>
    );
  }

  return (
    <Card variant="outlined">
      <Box
        data-setting-key="opening"
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr auto",
            sm: "minmax(0, 2fr) minmax(0, 2.4fr) auto",
          },
          alignItems: "center",
          columnGap: 2,
          rowGap: 0.5,
          px: 2,
          py: 1.5,
        }}
      >
        <Stack sx={{ minWidth: 0 }}>
          <Typography variant="body2">{t("label")}</Typography>
          <Typography
            variant="caption"
            color="textSecondary"
            sx={{ display: { sm: "none" } }}
          >
            {value}
          </Typography>
        </Stack>
        <Typography
          variant="body2"
          sx={{ display: { xs: "none", sm: "block" } }}
        >
          {value}
        </Typography>
        <Box sx={{ textAlign: "right" }}>{action}</Box>
      </Box>
      {dialog === "close" && (
        <CloseOpeningDialog
          opening={opening}
          isPending={isPending}
          onConfirm={() => {
            close.mutate({ orgId });
          }}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      {dialog === "reopen" && (
        <ReopenOpeningDialog
          opening={opening}
          isPending={isPending}
          onConfirm={(reason) => {
            reopen.mutate({ input: { orgId, reason } });
          }}
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
    </Card>
  );
};

interface DialogProps {
  opening: Opening;
  isPending: boolean;
  onClose: () => void;
}

/** [結束期初建檔] 確認(Figma CS-50i;規格 6)。 */
const CloseOpeningDialog = ({
  opening,
  isPending,
  onConfirm,
  onClose,
}: DialogProps & { onConfirm: () => void }) => {
  const t = useTranslations("admin.lotterySettings.opening.closeDialog");
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      title={t("title", { org: opening.org.name })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("back")}
          </Button>
          <Button disabled={isPending} onClick={onConfirm}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Typography variant="body2" color="textSecondary">
        {t("body", { count: opening.bookCount })}
      </Typography>
    </Dialog>
  );
};

/** [重新開放](Figma CS-50j;E1):原因必填。 */
const ReopenOpeningDialog = ({
  opening,
  isPending,
  onConfirm,
  onClose,
}: DialogProps & { onConfirm: (reason: string) => void }) => {
  const t = useTranslations("admin.lotterySettings.opening.reopenDialog");
  const [reason, setReason] = useState("");
  const [isInvalid, setInvalid] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      title={t("title", { org: opening.org.name })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("back")}
          </Button>
          <Button
            disabled={isPending}
            onClick={() => {
              const trimmed = reason.trim();
              if (trimmed === "") {
                setInvalid(true);
                return;
              }
              onConfirm(trimmed);
            }}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2" color="textSecondary">
          {t("body")}
        </Typography>
        <TextField
          label={t("reason")}
          value={reason}
          required
          multiline
          minRows={2}
          error={isInvalid}
          helperText={isInvalid ? t("reasonRequired") : undefined}
          onChange={(event) => {
            setReason(event.target.value);
            setInvalid(false);
          }}
        />
      </Stack>
    </Dialog>
  );
};
