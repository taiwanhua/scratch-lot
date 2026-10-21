import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import { REASON_OTHER_VALUE } from "@repo/domain/project/reason-note";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  type ScheduleAttendancePunchFieldsFragment,
  useReassignSchedulePunchMutation,
  useScheduleAttendancePunchEntryOptionsQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";

import { scheduleErrorOf } from "../schedule-error";
import { useAttendanceText } from "./useAttendanceText";

type Punch = ScheduleAttendancePunchFieldsFragment;
type Field = "punchId" | "entryId" | "reasonKey" | "reasonNote";

const EDITABLE_FIELDS: ReadonlySet<Field> = new Set([
  "entryId",
  "reasonKey",
  "reasonNote",
]);

/** 「沒有排班」在下拉的值(送出時換成 null)。 */
const NO_ENTRY = "none";

/** 出勤紀錄兩個查詢的快取前綴(改完一起失效)。 */
const ATTENDANCE_QUERY_KEYS = [
  ["ScheduleAttendanceByStore"],
  ["ScheduleAttendanceByPerson"],
];

export interface ReassignPunchDialogProps {
  /** 這一列的卡(同一個人;多張時先選要改哪一張) */
  punches: readonly Punch[];
  onClose: () => void;
}

/**
 * 修改這張打卡對應的排班(SC-29;規格 14.7):卡的時間與類型不能改,只能改對應排班
 * (這個人打卡那天前後各一天的班,或「沒有排班」);原因必填(欄位管理「改對應排班原因」,
 * 選「其他」要填說明);api 記 audit_log。手機全螢幕。
 */
export const ReassignPunchDialog = ({
  punches,
  onClose,
}: ReassignPunchDialogProps) => {
  const t = useTranslations("admin.schedule.attendance.reassign");
  const tCommon = useTranslations("admin.schedule.common");
  const tErrors = useTranslations("admin.schedule.errors");
  const text = useAttendanceText();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const isMobile = useBreakpointDown("sm");
  const reasons = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.entryReassignReason,
  );
  const [punchId, setPunchId] = useState(punches[0]?.id ?? "");
  const punch = punches.find((item) => item.id === punchId) ?? null;
  const [entryId, setEntryId] = useState<string | null>(null);
  const [reasonKey, setReasonKey] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [invalid, setInvalid] = useState<Field[]>([]);
  const options = useScheduleAttendancePunchEntryOptionsQuery(
    session.client,
    { punchId },
    { enabled: punchId !== "" },
  );
  const entryOptions = options.data?.scheduleAttendancePunchEntryOptions ?? [];
  // 還沒選 = 目前的對應排班(未對應排班 = 「沒有排班」)
  const selected = entryId ?? punch?.entryId ?? NO_ENTRY;

  const reassign = useReassignSchedulePunchMutation(
    session.client,
    useMutationFeedback({
      success: t("saved"),
      error: (error) => tErrors(scheduleErrorOf(error).code),
      onSuccess: () => {
        for (const queryKey of ATTENDANCE_QUERY_KEYS) {
          void queryClient.invalidateQueries({ queryKey });
        }
        onClose();
      },
      onError: (error) => {
        setInvalid(
          (scheduleErrorOf(error).fields ?? []).filter(
            (field): field is Field => EDITABLE_FIELDS.has(field as Field),
          ),
        );
      },
    }),
  );

  const submit = () => {
    const note = reasonNote.trim();
    const missing: Field[] = [];
    if (punch === null) missing.push("punchId");
    if (reasonKey === "") missing.push("reasonKey");
    if (reasonKey === REASON_OTHER_VALUE && note === "") {
      missing.push("reasonNote");
    }
    setInvalid(missing);
    if (missing.length > 0 || punch === null) {
      return;
    }
    reassign.mutate({
      input: {
        punchId: punch.id,
        entryId: selected === NO_ENTRY ? null : selected,
        reasonKey,
        ...(note === "" ? {} : { reasonNote: note }),
      },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="xs"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button disabled={reassign.isPending} onClick={submit}>
            {tCommon("save")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {punches.length > 1 && (
          <SelectField
            label={t("punch")}
            value={punchId}
            required
            fullWidth
            options={punches.map((item) => ({
              value: item.id,
              label: text.punchLabel(item),
            }))}
            onChange={(next) => {
              setPunchId(next);
              setEntryId(null);
            }}
          />
        )}
        {punch !== null && (
          <Box
            sx={{ bgcolor: "action.hover", borderRadius: 1, px: 1.5, py: 1 }}
          >
            <Typography variant="body1">
              {t("summary", {
                name: punch.userName,
                punch: text.punchLabel(punch),
              })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("fixedHint")}
            </Typography>
          </Box>
        )}
        <SelectField
          label={t("entry")}
          value={selected}
          fullWidth
          error={invalid.includes("entryId")}
          options={[
            ...entryOptions.map((option) => ({
              value: option.id,
              label: text.entryOption(option),
            })),
            { value: NO_ENTRY, label: t("noEntry") },
          ]}
          onChange={(next) => {
            setEntryId(next);
            setInvalid((current) => current.filter((f) => f !== "entryId"));
          }}
        />
        <SelectField
          label={t("reason")}
          value={reasonKey}
          required
          fullWidth
          error={invalid.includes("reasonKey")}
          options={reasons.options}
          onChange={(next) => {
            setReasonKey(next);
            setInvalid((current) => current.filter((f) => f !== "reasonKey"));
          }}
        />
        {reasonKey === REASON_OTHER_VALUE && (
          <TextField
            label={t("note")}
            value={reasonNote}
            required
            fullWidth
            error={invalid.includes("reasonNote")}
            onChange={(event) => {
              setReasonNote(event.target.value);
              setInvalid((current) =>
                current.filter((f) => f !== "reasonNote"),
              );
            }}
          />
        )}
      </Stack>
    </Dialog>
  );
};
