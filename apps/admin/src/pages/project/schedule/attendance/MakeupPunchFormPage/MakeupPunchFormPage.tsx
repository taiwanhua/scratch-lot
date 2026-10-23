import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { toInstant, toIso } from "@repo/domain/form";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  FormSubmissionStatus,
  useMakeupPunchEntryOptionsQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { DateTimePicker } from "@repo/ui/date-time-picker";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { Radio } from "@repo/ui/radio";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useFormDraft } from "@/hooks/base/useFormDraft";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useMe } from "@/hooks/base/useMe";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import type { ModulePageProps } from "@/lib/base/module-tree";
import { dayKeyOf } from "@/lib/project/schedule-day-offs";
import { dayInstantOf } from "@/lib/project/schedule-roster";

import { scheduleFormatText } from "../../schedule-field-errors";
import {
  MAKEUP_PREFILL_KEYS,
  MAKEUP_PUNCH_FORM_KEY,
  MAKEUP_PUNCH_MODULE_KEY,
  MAKEUP_PUNCH_NO_ENTRY,
} from "../attendance-keys";
import { useAttendanceText } from "../useAttendanceText";
import {
  EMPTY_MAKEUP_PUNCH,
  type MakeupPunchField,
  type MakeupPunchState,
  invalidFieldsOf,
  makeupPunchStateOf,
  makeupPunchStoredValues,
  withPunchAtOrOrg,
} from "./makeup-punch-form";

const PREFILL_SCHEMA = z.string().default("");

/** 網址帶入的值(我的班表 [申請補卡]、出勤紀錄某一列 [補打卡]);本人可以改。 */
const usePrefill = (): MakeupPunchState => {
  const [at] = useUrlState(MAKEUP_PREFILL_KEYS.at, PREFILL_SCHEMA);
  const [org] = useUrlState(MAKEUP_PREFILL_KEYS.org, PREFILL_SCHEMA);
  const [type] = useUrlState(MAKEUP_PREFILL_KEYS.type, PREFILL_SCHEMA);
  const [entry] = useUrlState(MAKEUP_PREFILL_KEYS.entry, PREFILL_SCHEMA);
  const prefillAt = toInstant(at);
  return {
    ...EMPTY_MAKEUP_PUNCH,
    // 帶入的是時點(缺的那張卡的排班時間);不是時點就不帶
    punchAt: prefillAt === null ? "" : toIso(prefillAt),
    orgId: org,
    type: type === "out" ? "out" : "in",
    entry,
  };
};

interface FormBodyProps {
  initial: MakeupPunchState;
  isPending: boolean;
  errorText: string | null;
  notice?: string | null;
  onSubmit: (state: MakeupPunchState) => void;
  onCancel: () => void;
}

/** 補打卡申請的欄位(SC-13 + 規格 14.8 的「對應排班」必選)。 */
const MakeupPunchFormBody = ({
  initial,
  isPending,
  errorText,
  notice,
  onSubmit,
  onCancel,
}: FormBodyProps) => {
  const t = useTranslations("admin.schedule.attendance.makeup");
  const tAttendance = useTranslations("admin.schedule.attendance");
  const tSchedule = useTranslations("admin.schedule");
  const text = useAttendanceText();
  const { session } = useSession();
  const reasons = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.makeupPunchReason,
  );
  const [state, setState] = useState(initial);
  const [invalid, setInvalid] = useState<MakeupPunchField[]>([]);
  // 下拉列那天(租戶時區)前後各一天的排班:同一天只改時刻,查詢條件不變(以那天 00:00 查)
  const dayAt = dayInstantOf(
    dayKeyOf(state.punchAt, text.timezone),
    text.timezone,
  );
  const options = useMakeupPunchEntryOptionsQuery(
    session.client,
    { input: { at: dayAt ?? "", orgId: state.orgId } },
    { enabled: dayAt !== null && state.orgId !== "" },
  );
  const entryOptions = [
    ...(options.data?.makeupPunchEntryOptions ?? []).map((option) => ({
      value: option.id,
      // 跨三天:和 [改對應排班] 一樣帶日期(「11/4 早 08:30–14:30」)
      label: text.entryOption(option),
    })),
    { value: MAKEUP_PUNCH_NO_ENTRY, label: t("noEntry") },
  ];
  // 選的那一班的日期(改補打卡時間時判斷它還在不在新的前後一天範圍內);不在目前清單裡 = null
  const entryDateOf = (entryId: string): string | null =>
    options.data?.makeupPunchEntryOptions.find(
      (option) => option.id === entryId,
    )?.date ?? null;
  // 帶入的排班不在清單裡(已刪除 / 不在前後一天範圍內)時不選,讓本人重選
  const entryValue = entryOptions.some((option) => option.value === state.entry)
    ? state.entry
    : "";
  // 欄位錯了就在欄位正下方寫原因(REACT-18);「說明」的規則同原因欄的說明
  const fieldErrorOf = (field: MakeupPunchField) => {
    if (!invalid.includes(field)) {
      return;
    }
    return scheduleFormatText(
      tSchedule,
      field === "note" ? "reasonNote" : field,
    );
  };
  const clear = (field: MakeupPunchField) => {
    setInvalid((current) => current.filter((item) => item !== field));
  };

  const submit = () => {
    const entryLabel =
      entryOptions.find((option) => option.value === entryValue)?.label ?? "";
    const next = { ...state, entry: entryValue, entryLabel };
    const missing = invalidFieldsOf(next);
    setInvalid(missing);
    if (missing.length === 0) {
      onSubmit(next);
    }
  };

  return (
    // 頁面根的卡片不可被殼的 flex 欄壓扁(STYLE-08):Card 預設 overflow: hidden,flex-shrink: 1 會在矮視窗裁掉下半的欄位與按鈕
    <Card sx={{ p: { xs: 2, sm: 3 }, maxWidth: 720, flexShrink: 0 }}>
      <Stack spacing={2}>
        <Typography variant="h6" component="h1">
          {t("title")}
        </Typography>
        {notice !== null && notice !== undefined && (
          <Alert severity="info">{notice}</Alert>
        )}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <DateTimePicker
            label={t("punchAt")}
            value={state.punchAt === "" ? null : state.punchAt}
            timezone={text.timezone}
            fullWidth
            required
            error={invalid.includes("punchAt")}
            helperText={fieldErrorOf("punchAt")}
            onChange={(next, { isIncomplete }) => {
              // 打到一半(某一段還沒打完)不算改了時間:等打完再判斷對應排班要不要清空
              if (isIncomplete) {
                return;
              }
              setState((current) =>
                withPunchAtOrOrg(
                  current,
                  { punchAt: next ?? "" },
                  text.timezone,
                  entryDateOf(current.entry),
                ),
              );
              clear("punchAt");
            }}
          />
          <OrgTreeSelect
            // 業務表單欄位:可見範圍內的才能選(用法表 ④)
            scope="visible"
            label={t("branch")}
            value={state.orgId === "" ? [] : [state.orgId]}
            required
            fullWidth
            error={invalid.includes("orgId")}
            helperText={fieldErrorOf("orgId")}
            onChange={(ids) => {
              setState((current) =>
                withPunchAtOrOrg(
                  current,
                  { orgId: ids[0] ?? "" },
                  text.timezone,
                ),
              );
              clear("orgId");
            }}
          />
        </Stack>
        <SelectField
          label={t("entry")}
          value={entryValue}
          required
          fullWidth
          disabled={state.punchAt === "" || state.orgId === ""}
          error={invalid.includes("entry")}
          helperText={
            invalid.includes("entry") ? t("entryRequired") : t("entryHint")
          }
          options={entryOptions}
          onChange={(next) => {
            setState((current) => ({ ...current, entry: next }));
            clear("entry");
          }}
        />
        <Stack spacing={0.5}>
          <Typography variant="subtitle2" component="p">
            {t("type")}
          </Typography>
          <Stack direction="row" spacing={2}>
            {(["in", "out"] as const).map((option) => (
              <FormControlLabel
                key={option}
                label={
                  option === "in"
                    ? tAttendance("types.in")
                    : tAttendance("types.out")
                }
                control={
                  <Radio
                    checked={state.type === option}
                    onChange={() => {
                      setState((current) => ({ ...current, type: option }));
                    }}
                  />
                }
              />
            ))}
          </Stack>
        </Stack>
        <SelectField
          label={t("reason")}
          value={state.reasonKey}
          required
          fullWidth
          error={invalid.includes("reasonKey")}
          helperText={fieldErrorOf("reasonKey")}
          options={reasons.options}
          onChange={(next) => {
            setState((current) => ({
              ...current,
              reasonKey: next,
              reasonLabel: reasons.labelOf(next),
            }));
            clear("reasonKey");
          }}
        />
        <TextField
          label={t("note")}
          value={state.note}
          required={state.reasonKey === "other"}
          fullWidth
          error={invalid.includes("note")}
          helperText={fieldErrorOf("note")}
          onChange={(event) => {
            setState((current) => ({ ...current, note: event.target.value }));
            clear("note");
          }}
        />
        {errorText !== null && <Alert severity="error">{errorText}</Alert>}
        <FormActions
          // 外層卡片 `p: { xs: 2, sm: 3 }`
          gutter={{ xs: 2, sm: 3 }}
          cancel={{ label: t("cancel"), onClick: onCancel }}
          submit={{ label: t("submit"), disabled: isPending, onClick: submit }}
        />
      </Stack>
    </Card>
  );
};

/**
 * 補打卡申請的新增 / 編輯頁(SC-13;規格 14.8;替換表單引擎的新增頁與編輯頁):補打卡時間(日期時間)、分店、
 * **對應排班(必選)**、類型、原因。對應排班 = 選了補打卡時間與分店後列出本人在那家店、那天(租戶時區)前後各一天的
 * 排班(和 [改對應排班] 同一個範圍),最後一個是「沒有排班(臨時代班)」;改了分店就清空重選;改了補打卡時間,選的班還在新的前後一天範圍內就保留、不在才清空。沒有草稿(送出即進審核)。新增頁的帶入值在網址;編輯頁(被退回 / 撤回)
 * 讀那一筆的值。存值交給表單引擎(`useFormDraft` / `useFormSubmission`),流程與掛接點照常。
 */
export const MakeupPunchFormPage = ({
  module,
  routeParam,
}: ModulePageProps) => {
  const t = useTranslations("admin.schedule.attendance.makeup");
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const showSnackbar = useSnackbar();
  const access = useFormModuleAccess(MAKEUP_PUNCH_MODULE_KEY);
  const me = useMe();
  const isEdit = module.key.endsWith(".edit-page");
  const id = isEdit ? (routeParam ?? "") : "";
  const draft = useFormDraft(MAKEUP_PUNCH_FORM_KEY);
  const existing = useFormSubmission(id);
  const prefill = usePrefill();
  useRouteTabItemLabel(t("title"));

  const leave = () => {
    if (access.listRoute !== null) {
      void navigate(tabHref(access.listRoute));
    }
  };
  const afterSubmit = (submitted: { id: string } | null) => {
    if (submitted === null) {
      return;
    }
    showSnackbar("success", t("submitted"));
    if (access.viewRoute === null) {
      leave();
    } else {
      void navigate(`${access.viewRoute}/${submitted.id}`);
    }
  };

  if (isEdit) {
    const { submission } = existing;
    if (existing.isLoading) {
      return <CircularProgress aria-label={t("loading")} />;
    }
    if (submission?.abilities.canEdit !== true) {
      return <Alert severity="error">{t("unavailable")}</Alert>;
    }
    return (
      <MakeupPunchFormBody
        key={submission.editVersion}
        initial={makeupPunchStateOf(submission.values)}
        isPending={existing.isPending}
        errorText={existing.error === null ? null : errorText(existing.error)}
        notice={
          submission.status === FormSubmissionStatus.Returned
            ? t("returnedHint")
            : null
        }
        onSubmit={(state) => {
          void existing
            .submit(makeupPunchStoredValues(state))
            .then(afterSubmit);
        }}
        onCancel={leave}
      />
    );
  }

  // 店員預設自己的分店(帶入值優先)
  const currentOrg = me.data?.me.currentOrg;
  const initial: MakeupPunchState = {
    ...prefill,
    orgId: prefill.orgId === "" ? (currentOrg?.id ?? "") : prefill.orgId,
  };
  if (me.isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  return (
    <MakeupPunchFormBody
      initial={initial}
      isPending={draft.isPending}
      errorText={draft.error === null ? null : errorText(draft.error)}
      onSubmit={(state) => {
        void draft.submit(makeupPunchStoredValues(state), []).then(afterSubmit);
      }}
      onCancel={leave}
    />
  );
};
