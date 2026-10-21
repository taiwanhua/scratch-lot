import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { requiresReasonNote } from "@repo/domain/project/reason-note";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  useLotteryShiftInfoQuery,
  useReassignLotteryShiftEntryMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import {
  EMPTY_REASON,
  type ReasonValue,
  missingReasonFields,
  reasonInputOf,
} from "@/components/project/lottery/ReasonFields/reason-value";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import { storeErrorKey, storeErrorOf } from "@/lib/project/lottery/store-error";

import { moneyText } from "../store-text";
import { STORE_BOARD_QUERY_KEY } from "./board-query";
import { useEntryText } from "./useEntryText";

/** 「沒有排班(臨時代班)」的選項值(其他選項是排班 id)。 */
const TEMPORARY = "temporary";

export interface ShiftInfoDialogProps {
  shiftId: string;
  onClose: () => void;
}

/**
 * 班次資訊(ST-42a)與改對應排班(ST-42b)(專案規格 6.6、14.9):收銀點標題列點負責人那一行打開。
 * [改對應排班] 只有這一班的負責人或店長、交班結帳送出前看得到(api 回 `canReassign`);
 * 原因必填(欄位管理「改對應排班原因」,選「其他」說明必填),改完任務快照依新的排班重寫。
 */
export const ShiftInfoDialog = ({ shiftId, onClose }: ShiftInfoDialogProps) => {
  const t = useTranslations("admin.lotteryStore");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const text = useEntryText();
  const reasons = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.entryReassignReason,
  );
  const query = useLotteryShiftInfoQuery(
    session.client,
    { id: shiftId },
    { retry: false },
  );
  const info = query.data?.lotteryShiftInfo.item ?? null;
  const [isEditing, setIsEditing] = useState(false);
  const [entry, setEntry] = useState<string>(TEMPORARY);
  const [reason, setReason] = useState<ReasonValue>(EMPTY_REASON);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const reassign = useReassignLotteryShiftEntryMutation(
    session.client,
    useMutationFeedback({
      success: t("reassign.success"),
      error: (error: unknown) => t(storeErrorKey(error)),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: STORE_BOARD_QUERY_KEY });
        void query.refetch();
        setIsEditing(false);
      },
      onError: (error: unknown) => {
        setErrorKey(storeErrorKey(error));
        setInvalid(storeErrorOf(error).fields ?? []);
      },
    }),
  );

  const startEditing = () => {
    setEntry(info?.entry?.id ?? TEMPORARY);
    setReason(EMPTY_REASON);
    setInvalid([]);
    setErrorKey(null);
    setIsEditing(true);
  };

  const submit = () => {
    const missing = missingReasonFields(reason);
    setInvalid(missing);
    setErrorKey(null);
    if (missing.length > 0) {
      return;
    }
    reassign.mutate({
      input: {
        shiftId,
        temporaryCover: entry === TEMPORARY,
        scheduleEntryId: entry === TEMPORARY ? null : entry,
        ...reasonInputOf(reason),
      },
    });
  };

  const rows: { key: string; label: string; value: string }[] =
    info === null
      ? []
      : [
          {
            key: "owner",
            label: t("shiftInfo.owner"),
            value: t("shiftInfo.ownerValue", {
              name: info.openedBy.name,
              time: text.timeOf(info.openedAt),
            }),
          },
          {
            key: "float",
            label: t("shiftInfo.float"),
            value: moneyText(info.openingFloat),
          },
          {
            key: "entry",
            label: t("shiftInfo.entry"),
            value:
              info.entry == null
                ? t("shiftInfo.unmatched")
                : text.entryLabel(info.entry),
          },
          {
            key: "snapshot",
            label: t("shiftInfo.snapshot"),
            value:
              info.taskSnapshot == null
                ? t("shiftInfo.empty")
                : text.taskLabel(info.taskSnapshot),
          },
        ];

  if (isEditing && info !== null) {
    const noteRequired = requiresReasonNote(reason.reasonKey);
    return (
      <Dialog
        open
        onClose={onClose}
        fullWidth
        maxWidth="sm"
        fullScreen={isMobile}
        title={t("reassign.title")}
        actions={
          <>
            <Button
              variant="text"
              onClick={() => {
                setIsEditing(false);
              }}
            >
              {t("reassign.cancel")}
            </Button>
            <Button disabled={reassign.isPending} onClick={submit}>
              {t("reassign.save")}
            </Button>
          </>
        }
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          {errorKey === null ? null : (
            <Alert severity="error">{t(errorKey)}</Alert>
          )}
          <RadioGroup
            value={entry}
            onChange={(event) => {
              setEntry(event.target.value);
            }}
          >
            {info.entryOptions.map((option) => (
              <FormControlLabel
                key={option.id}
                value={option.id}
                control={<Radio />}
                label={text.entryLabel(option)}
              />
            ))}
            <FormControlLabel
              value={TEMPORARY}
              control={<Radio />}
              label={t("openShift.temporary")}
            />
          </RadioGroup>
          <SelectField
            label={t("reassign.reason")}
            value={reason.reasonKey}
            required
            fullWidth
            error={invalid.includes("reasonKey")}
            options={reasons.options}
            onChange={(value: string) => {
              setReason({ ...reason, reasonKey: value });
            }}
          />
          <TextField
            label={
              noteRequired ? t("reasonNote.noteRequired") : t("reasonNote.note")
            }
            value={reason.reasonNote}
            required={noteRequired}
            error={invalid.includes("reasonNote")}
            onChange={(event) => {
              setReason({ ...reason, reasonNote: event.target.value });
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {t("reassign.hint")}
          </Typography>
        </Stack>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      title={t("shiftInfo.title", { name: info?.cashPoint.name ?? "" })}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("shiftInfo.close")}
          </Button>
          {info?.canReassign === true ? (
            <Button variant="outlined" onClick={startEditing}>
              {t("shiftInfo.reassign")}
            </Button>
          ) : null}
        </>
      }
    >
      <Stack spacing={1.5} sx={{ pt: 1 }}>
        {query.isError ? (
          <Alert severity="error">{t(storeErrorKey(query.error))}</Alert>
        ) : null}
        {rows.map((row) => (
          <Stack
            key={row.key}
            direction="row"
            spacing={2}
            sx={{ justifyContent: "space-between" }}
          >
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
            >
              {row.label}
            </Typography>
            <Typography
              variant="body2"
              color="text.primary"
              sx={{ textAlign: "right" }}
            >
              {row.value}
            </Typography>
          </Stack>
        ))}
        {info?.positionMismatch === true ? (
          <Alert severity="warning">{t("shiftInfo.mismatch")}</Alert>
        ) : null}
        {info?.closed === true ? (
          <Typography variant="caption" color="text.secondary">
            {t("shiftInfo.closedHint")}
          </Typography>
        ) : null}
      </Stack>
    </Dialog>
  );
};
