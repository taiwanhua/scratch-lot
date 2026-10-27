import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type LotteryStoreOpenShiftFormQuery,
  useLotteryStoreOpenShiftFormQuery,
  useOpenLotteryShiftMutation,
  usePunchLotteryShiftStartMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import {
  type FieldErrorTexts,
  withoutFieldError,
} from "@/lib/base/field-errors";
import { storeErrorKey } from "@/lib/project/lottery/store-error";

import { storeErrorTextsOf, storeFormatErrorsOf } from "../store-field-errors";
import { moneyText } from "../store-text";
import { STORE_BOARD_QUERY_KEY } from "./board-query";
import { useEntryText } from "./useEntryText";

/** 「沒有排班(臨時代班)」的選項值(其他選項是排班 id)。 */
const TEMPORARY = "temporary";

/** 我的班表打卡的權限(`schedule.my.punch`;開班視窗的 [打卡] 由排班模組再檢查一次)。 */
const MY_PUNCH = "schedule.my.punch";

type OpenShiftForm =
  LotteryStoreOpenShiftFormQuery["lotteryStoreOpenShiftForm"]["item"];

/** 期初零用金:金額 + 來源(上一班留給下一班)/「從小金庫領零用金」(第一班、有出庫權限)。 */
const FloatSection = ({
  form,
  float,
  opening,
  errorText,
  onFloatChange,
}: {
  form: OpenShiftForm;
  float: string;
  opening: number;
  /** 欄位下的原因(REACT-18);undefined = 沒錯 */
  errorText: string | undefined;
  onFloatChange: (value: string) => void;
}) => {
  const t = useTranslations("admin.lotteryStore.openShift");
  const text = useEntryText();
  return (
    <>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "baseline" }}
      >
        <Typography variant="body1" color="textSecondary">
          {t("float")}
        </Typography>
        <Typography variant="h6" color="textPrimary">
          {moneyText(opening)}
        </Typography>
      </Stack>
      {form.plan === "handover" ? (
        <Typography variant="caption" color="textSecondary">
          {t("handoverSource", {
            name: form.previousOpenedBy?.name ?? "",
            time:
              form.previousClosedAt == null
                ? ""
                : text.timeOf(form.previousClosedAt),
          })}
        </Typography>
      ) : null}
      {form.plan === "first" && form.canTakeFloat ? (
        <TextField
          label={t("floatFromVault")}
          value={float}
          helperText={errorText ?? t("floatFromVaultHint")}
          error={errorText !== undefined}
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          onChange={(event) => {
            onFloatChange(event.target.value);
          }}
        />
      ) : null}
      {form.plan === "first" && !form.canTakeFloat ? (
        <Typography variant="caption" color="textSecondary">
          {t("floatFirstNoWithdraw")}
        </Typography>
      ) : null}
    </>
  );
};

/** 會標回對話框的欄位(api `fields`)。 */
const FIELDS = ["floatFromVault", "scheduleEntryId"] as const;

/** 期初零用金:其他班 = 上一班留給下一班;第一班 = 從小金庫領的(沒有出庫權限 = 0)。 */
const openingOf = (form: OpenShiftForm, float: number): number => {
  if (form.plan === "handover") {
    return form.handoverAmount;
  }
  return form.canTakeFloat ? float : 0;
};

/** 崗位不一致的提醒(只提醒,照樣開班並記錄):這筆排班填進的是哪些崗位。 */
const MismatchAlert = ({
  entry,
  cashPointName,
}: {
  entry: OpenShiftForm["entries"][number];
  cashPointName: string;
}) => {
  const t = useTranslations("admin.lotteryStore.openShift");
  const text = useEntryText();
  const positions = [
    ...new Set(entry.tasks.map((task) => text.positionLabel(task.positionKey))),
  ];
  return (
    <Alert severity="warning">
      {t("mismatch", {
        positions: positions.length === 0 ? t("noTask") : positions.join("、"),
        cashPoint: cashPointName,
      })}
    </Alert>
  );
};

/** 還沒打上班卡的提示卡 [打卡](打這一班的上班卡)。 */
const PunchCard = ({
  isPending,
  onPunch,
}: {
  isPending: boolean;
  onPunch: () => void;
}) => {
  const t = useTranslations("admin.lotteryStore.openShift");
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        px: 1.5,
        py: 1,
        borderRadius: 2,
        bgcolor: "warning.lighter",
        color: "text.primary",
      }}
    >
      <Typography variant="body2">{t("notPunched")}</Typography>
      <Button
        size="small"
        variant="outlined"
        disabled={isPending}
        onClick={onPunch}
      >
        {t("punch")}
      </Button>
    </Box>
  );
};

/** 開班時從小金庫領了零用金:寫入成功後交給列印的資料(58mm 出庫單,原因 = 開班零用金)。 */
export interface OpeningFloatCommitted {
  movementId: string;
  cashPointPrinterId: string | null;
  amount: number;
}

export interface OpenShiftDialogProps {
  cashPointId: string;
  cashPointName: string;
  onClose: () => void;
  /** 開班成功且領了零用金(寫了出庫流水)之後;沒領不呼叫 */
  onFloatTaken?: (committed: OpeningFloatCommitted) => void;
}

/**
 * 開班(專案規格 6.2、6.6、14.9;Figma ST-04a/b/c):期初零用金(第一班可「從小金庫領零用金」、
 * 其他班唯讀並顯示來源)、對應排班必選(系統找到的預選,可改選或「沒有排班(臨時代班)」)、
 * 崗位不一致提醒(只提醒,照樣開班並記錄)、還沒打上班卡的提示卡 [打卡]。有表單欄位,手機全螢幕。
 * 領了零用金 → `onFloatTaken`(看板照出庫自動印出庫單,規格 6.6、第 12 章)。
 */
export const OpenShiftDialog = ({
  cashPointId,
  cashPointName,
  onClose,
  onFloatTaken,
}: OpenShiftDialogProps) => {
  const t = useTranslations("admin.lotteryStore");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const { hasPermission } = usePermissions();
  const text = useEntryText();
  const formQuery = useLotteryStoreOpenShiftFormQuery(
    session.client,
    { cashPointId },
    { retry: false },
  );
  const form = formQuery.data?.lotteryStoreOpenShiftForm.item ?? null;
  // 預選系統找到的排班;找不到 → 沒有排班(臨時代班)
  const [chosenEntry, setEntry] = useState<string | null>(null);
  const entry =
    chosenEntry ??
    (form === null ? null : (form.suggestedEntryId ?? TEMPORARY));
  const [float, setFloat] = useState("");
  // 欄位錯了就在欄位正下方寫原因(REACT-18);上方提示只放通用句
  const [fieldErrors, setFieldErrors] = useState<
    FieldErrorTexts<(typeof FIELDS)[number]>
  >({});
  const [errorText, setErrorText] = useState<string | null>(null);

  const open = useOpenLotteryShiftMutation(
    session.client,
    useMutationFeedback({
      success: t("openShift.success"),
      error: (error: unknown) => storeErrorTextsOf(error, FIELDS, t).summary,
      onSuccess: (data, variables) => {
        const { movementId, cashPointPrinterId } = data.openLotteryShift;
        const amount = variables.input.floatFromVault ?? 0;
        if (movementId != null && amount > 0) {
          onFloatTaken?.({
            movementId,
            cashPointPrinterId: cashPointPrinterId ?? null,
            amount,
          });
        }
        void queryClient.invalidateQueries({ queryKey: STORE_BOARD_QUERY_KEY });
        onClose();
      },
      onError: (error: unknown) => {
        const { texts, summary } = storeErrorTextsOf(error, FIELDS, t);
        setFieldErrors(texts);
        setErrorText(summary);
      },
    }),
  );
  const punch = usePunchLotteryShiftStartMutation(
    session.client,
    useMutationFeedback({
      success: t("openShift.punchSuccess"),
      error: (error: unknown) => t(storeErrorKey(error)),
      onSuccess: () => {
        void formQuery.refetch();
      },
    }),
  );

  const selected = form?.entries.find((option) => option.id === entry) ?? null;
  const isMismatch = selected !== null && selected.snapshot == null;
  const floatValue = float.trim() === "" ? 0 : Number(float.trim());
  const isFloatValid = Number.isInteger(floatValue) && floatValue >= 0;

  const submit = () => {
    if (entry === null) {
      return;
    }
    if (!isFloatValid) {
      setFieldErrors(storeFormatErrorsOf(["floatFromVault"], t));
      return;
    }
    setFieldErrors({});
    setErrorText(null);
    open.mutate({
      input: {
        cashPointId,
        temporaryCover: entry === TEMPORARY,
        scheduleEntryId: entry === TEMPORARY ? null : entry,
        floatFromVault: form?.canTakeFloat === true ? floatValue : null,
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
      title={t("openShift.title", { name: cashPointName })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("openShift.cancel")}
          </Button>
          <Button
            disabled={form === null || entry === null || open.isPending}
            onClick={submit}
          >
            {isMismatch ? t("openShift.submitAnyway") : t("openShift.submit")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {errorText === null ? null : (
          <Alert severity="error">{errorText}</Alert>
        )}
        {formQuery.isError ? (
          <Alert severity="error">{t(storeErrorKey(formQuery.error))}</Alert>
        ) : null}
        {form === null ? null : (
          <FloatSection
            form={form}
            float={float}
            opening={openingOf(form, isFloatValid ? floatValue : 0)}
            errorText={fieldErrors.floatFromVault}
            onFloatChange={(value) => {
              setFloat(value);
              setFieldErrors((current) =>
                withoutFieldError(current, "floatFromVault"),
              );
            }}
          />
        )}
        {selected !== null &&
        !selected.hasStartPunch &&
        hasPermission(MY_PUNCH) ? (
          <PunchCard
            isPending={punch.isPending}
            onPunch={() => {
              punch.mutate({ entryId: selected.id });
            }}
          />
        ) : null}
        <SelectField
          label={t("openShift.entry")}
          value={entry ?? ""}
          required
          fullWidth
          error={fieldErrors.scheduleEntryId !== undefined}
          helperText={
            fieldErrors.scheduleEntryId ??
            (form !== null && form.entries.length === 0
              ? t("openShift.noEntryToday")
              : t("openShift.entryHint"))
          }
          options={[
            ...(form?.entries ?? []).map((option) => ({
              value: option.id,
              label: text.entryLabel(option),
            })),
            { value: TEMPORARY, label: t("openShift.temporary") },
          ]}
          onChange={(value: string) => {
            setEntry(value);
            setFieldErrors((current) =>
              withoutFieldError(current, "scheduleEntryId"),
            );
          }}
        />
        {isMismatch ? (
          <MismatchAlert entry={selected} cashPointName={cashPointName} />
        ) : null}
      </Stack>
    </Dialog>
  );
};
