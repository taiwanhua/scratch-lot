import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { REASON_OTHER_VALUE } from "@repo/domain/project/reason-note";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  type ScheduleDayOffFieldsFragment,
  useDeleteScheduleDayOffOnBehalfMutation,
} from "@repo/graphql";
import { SelectField } from "@repo/ui/select-field";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import type { FieldErrorTexts } from "@/lib/base/field-errors";
import { shortDate } from "@/lib/project/schedule-day-offs";

import { ConfirmDeleteDialog } from "../../ConfirmDeleteDialog";
import {
  scheduleErrorTextsOf,
  scheduleFormatErrorsOf,
} from "../../schedule-field-errors";

/** codegen 的 query key 第一段是 operation 名稱(`useScheduleDayOffOverviewQuery.getKey`)。 */
const OVERVIEW_QUERY_KEY = "ScheduleDayOffOverview";
/** 會標回確認框的欄位(api `fields`)。 */
const FIELD_LIST = ["reason", "reasonNote"] as const;

type Field = (typeof FIELD_LIST)[number];

export interface DeleteDayOffDialogProps {
  /** 總覽選的分店(代改的對象要是這家店的排班人員) */
  orgId: string;
  item: ScheduleDayOffFieldsFragment;
  /** 這個月的開放期間已截止:原因必填(api 依那個人的主要分店再判斷一次) */
  reasonRequired: boolean;
  onClose: () => void;
}

/**
 * 畫休總覽 → 當天畫休 → [刪除] 的確認(SC-24;規格 14.5「畫休總覽」,`edit-day-offs`):
 * 「刪除 王小明 12/24 的整天畫休?」;截止後在確認框裡選原因(欄位管理「代改畫休原因」,選「其他」要填說明),
 * 截止前只按確認。api 判斷要原因(那個人的主要分店已截止)時也會把原因欄打開。
 */
export const DeleteDayOffDialog = ({
  orgId,
  item,
  reasonRequired,
  onClose,
}: DeleteDayOffDialogProps) => {
  const t = useTranslations("admin.schedule.dayOffs.override");
  const tSchedule = useTranslations("admin.schedule");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const reasons = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.dayOffOverrideReason,
  );
  const [reason, setReason] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  // api 判斷要原因(畫面依總覽的開放期間判斷,api 依那個人的主要分店)→ 原因欄也打開
  const [askedReason, setAskedReason] = useState(false);
  const showReason = reasonRequired || askedReason;
  const [fieldErrors, setFieldErrors] = useState<FieldErrorTexts<Field>>({});
  const invalid = Object.keys(fieldErrors);

  const remove = useDeleteScheduleDayOffOnBehalfMutation(
    session.client,
    useMutationFeedback({
      success: t("deleteSuccess"),
      error: (error: unknown) =>
        scheduleErrorTextsOf(error, FIELD_LIST, tSchedule).summary,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: [OVERVIEW_QUERY_KEY] });
        onClose();
      },
      onError: (error: unknown) => {
        const { texts } = scheduleErrorTextsOf(error, FIELD_LIST, tSchedule);
        if (Object.keys(texts).length > 0) {
          setAskedReason(true);
        }
        setFieldErrors(texts);
      },
    }),
  );

  const note = reasonNote.trim();
  const confirm = () => {
    const missing: Field[] = [];
    if (showReason && reason === "") missing.push("reason");
    if (reason === REASON_OTHER_VALUE && note === "") {
      missing.push("reasonNote");
    }
    setFieldErrors(scheduleFormatErrorsOf(missing, tSchedule));
    if (missing.length > 0) {
      return;
    }
    remove.mutate({
      input: {
        orgId,
        id: item.id,
        reason: reason === "" ? null : reason,
        reasonNote: note === "" ? null : note,
      },
    });
  };

  const values = { name: item.name, date: shortDate(item.date) };
  return (
    <ConfirmDeleteDialog
      title={t("deleteTitle")}
      message={
        item.kind === "full-day"
          ? t("deleteFullDay", values)
          : t("deleteTimeRange", {
              ...values,
              start: item.startTime ?? "",
              end: item.endTime ?? "",
            })
      }
      confirmLabel={t("deleteConfirm")}
      isPending={remove.isPending}
      onConfirm={confirm}
      onCancel={onClose}
    >
      {showReason && (
        <>
          <SelectField
            label={t("reason")}
            value={reason}
            required
            fullWidth
            error={invalid.includes("reason")}
            helperText={fieldErrors.reason}
            options={reasons.options}
            onChange={(next) => {
              setReason(next);
              setFieldErrors({});
            }}
          />
          {reason === REASON_OTHER_VALUE && (
            <TextField
              label={t("reasonNote")}
              value={reasonNote}
              required
              fullWidth
              error={invalid.includes("reasonNote")}
              helperText={fieldErrors.reasonNote}
              onChange={(event) => {
                setReasonNote(event.target.value);
                setFieldErrors({});
              }}
            />
          )}
          <Typography variant="caption" color="textSecondary">
            {t("reasonHint")}
          </Typography>
        </>
      )}
    </ConfirmDeleteDialog>
  );
};
