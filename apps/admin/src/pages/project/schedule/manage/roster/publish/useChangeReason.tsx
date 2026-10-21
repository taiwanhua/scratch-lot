import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";

import { REASON_OTHER_VALUE } from "@repo/domain/project/reason-note";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";

import { RuleViolationsAlert } from "../check-panel/RuleViolationsAlert";
import {
  type RosterRuleViolationError,
  rosterRuleViolationsOf,
} from "../check-panel/check-errors";
import { useRosterCheck } from "../check-panel/roster-check-context";
import { errorFieldsOf } from "../roster-error";

type ReasonField = "reasonKey" | "reasonNote";

/** 送出時附在 input 的異動原因(未發布 = 不附)。 */
export interface ChangeReasonPart {
  changeReason?: { reasonKey: string; reasonNote?: string };
}

export interface ChangeReasonApi {
  /** 這個月已發布:修改要填異動原因 */
  isRequired: boolean;
  /** 送出前驗:回要附在 input 的部分;沒填好 → 標紅並回 null(不要送) */
  take: () => ChangeReasonPart | null;
  /** 附上原因(確認視窗之後送出用;沒填好就不附,api 會標回欄位) */
  withReason: <Input extends object>(input: Input) => Input & ChangeReasonPart;
  /**
   * 讀 api 的錯誤:原因欄位標紅;存排班被規則(限制)擋下時記下違反(畫在 `alert`)。
   * 有處理到回 true(呼叫端就不另外顯示一般錯誤)
   */
  markFromError: (error: unknown) => boolean;
  /** 對話框裡的欄位(未發布 = null) */
  fields: ReactNode;
  /** 被規則擋下的說明(沒有 = null) */
  alert: ReactNode;
}

/**
 * 已發布後的「異動原因」(SC-19;規格 14.5:已發布後兩種對話框都多一個異動原因,必填,
 * 欄位管理「排班異動原因」;選「其他」要填說明)。排班對話框、人力需求對話框、移除這天所有排班共用;
 * 同一個對話框的儲存與刪除都用這一份(原因只填一次)。存排班被規則(限制)擋下的說明也在這裡讀出
 * (`alert`;規格 14.2「限制 → 不能存」)。
 */
export const useChangeReason = (canEdit: boolean): ChangeReasonApi => {
  const t = useTranslations("admin.schedule.roster.changeReason");
  // 讀檢核的 context(包住整頁):工具列登記的對話框(套用範本)畫在排班表內容外面,也用得到
  const { data } = useRosterCheck();
  const reasons = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.changeReason,
  );
  const isRequired = data?.period.status === "published";
  const [reasonKey, setReasonKey] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [invalid, setInvalid] = useState<ReasonField[]>([]);
  const [violations, setViolations] = useState<RosterRuleViolationError[]>([]);

  const take = (): ChangeReasonPart | null => {
    if (!isRequired) {
      return {};
    }
    const note = reasonNote.trim();
    const missing: ReasonField[] = [];
    if (reasonKey === "") {
      missing.push("reasonKey");
    }
    if (reasonKey === REASON_OTHER_VALUE && note === "") {
      missing.push("reasonNote");
    }
    setInvalid(missing);
    if (missing.length > 0) {
      return null;
    }
    return {
      changeReason: { reasonKey, ...(note === "" ? {} : { reasonNote: note }) },
    };
  };

  const markFromError = (error: unknown) => {
    const blocked = rosterRuleViolationsOf(error);
    setViolations(blocked);
    const fields = errorFieldsOf(error).filter(
      (field): field is ReasonField =>
        field === "reasonKey" || field === "reasonNote",
    );
    if (fields.length > 0) {
      setInvalid(fields);
    }
    return fields.length > 0 || blocked.length > 0;
  };

  const fields = isRequired ? (
    <Stack spacing={1}>
      <SelectField
        label={t("label")}
        value={reasonKey}
        required
        fullWidth
        disabled={!canEdit}
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
          disabled={!canEdit}
          error={invalid.includes("reasonNote")}
          onChange={(event) => {
            setReasonNote(event.target.value);
            setInvalid((current) => current.filter((f) => f !== "reasonNote"));
          }}
        />
      )}
      <Typography variant="caption" color="text.secondary">
        {t("hint")}
      </Typography>
    </Stack>
  ) : null;

  const withReason = <Input extends object>(
    input: Input,
  ): Input & ChangeReasonPart => ({ ...take(), ...input });

  return {
    isRequired,
    take,
    withReason,
    markFromError,
    fields,
    alert: <RuleViolationsAlert violations={violations} />,
  };
};
