import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";
import {
  FormSubmissionStatus,
  useMakeupPunchEntryOptionsQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { DatePicker } from "@repo/ui/date-picker";
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
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";
import { useScheduleFieldOptions } from "@/hooks/project/schedule/useScheduleFieldOptions/useScheduleFieldOptions";
import type { ModulePageProps } from "@/lib/base/module-tree";

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
  withDateOrOrg,
} from "./makeup-punch-form";

const PREFILL_SCHEMA = z.string().default("");
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** 網址帶入的值(我的班表 [申請補卡]、出勤紀錄某一列 [補打卡]);本人可以改。 */
const usePrefill = (): MakeupPunchState => {
  const [date] = useUrlState(MAKEUP_PREFILL_KEYS.date, PREFILL_SCHEMA);
  const [org] = useUrlState(MAKEUP_PREFILL_KEYS.org, PREFILL_SCHEMA);
  const [type] = useUrlState(MAKEUP_PREFILL_KEYS.type, PREFILL_SCHEMA);
  const [entry] = useUrlState(MAKEUP_PREFILL_KEYS.entry, PREFILL_SCHEMA);
  return {
    ...EMPTY_MAKEUP_PUNCH,
    date: DATE_PATTERN.test(date) ? date : "",
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
  const text = useAttendanceText();
  const { session } = useSession();
  const reasons = useScheduleFieldOptions(
    SCHEDULE_FIELD_CATEGORY_KEYS.makeupPunchReason,
  );
  const [state, setState] = useState(initial);
  const [invalid, setInvalid] = useState<MakeupPunchField[]>([]);
  const options = useMakeupPunchEntryOptionsQuery(
    session.client,
    { input: { date: state.date, orgId: state.orgId } },
    { enabled: state.date !== "" && state.orgId !== "" },
  );
  const entryOptions = [
    ...(options.data?.makeupPunchEntryOptions ?? []).map((option) => ({
      value: option.id,
      label: text.entry(option),
    })),
    { value: MAKEUP_PUNCH_NO_ENTRY, label: t("noEntry") },
  ];
  // 帶入的排班不在清單裡(已刪除 / 換了日期)時不選,讓本人重選
  const entryValue = entryOptions.some((option) => option.value === state.entry)
    ? state.entry
    : "";
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
    <Card sx={{ p: { xs: 2, sm: 3 }, maxWidth: 720 }}>
      <Stack spacing={2}>
        <Typography variant="h6" component="h1">
          {t("title")}
        </Typography>
        {notice !== null && notice !== undefined && (
          <Alert severity="info">{notice}</Alert>
        )}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <DatePicker
            label={t("date")}
            value={state.date === "" ? null : state.date}
            fullWidth
            required
            error={invalid.includes("date")}
            onChange={(next) => {
              setState((current) =>
                withDateOrOrg(current, { date: next ?? "" }),
              );
              clear("date");
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
            onChange={(ids) => {
              setState((current) =>
                withDateOrOrg(current, { orgId: ids[0] ?? "" }),
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
          disabled={state.date === "" || state.orgId === ""}
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
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <TextField
            label={t("time")}
            type="time"
            value={state.time}
            required
            fullWidth
            error={invalid.includes("time")}
            slotProps={{ inputLabel: { shrink: true } }}
            onChange={(event) => {
              setState((current) => ({ ...current, time: event.target.value }));
              clear("time");
            }}
          />
          <SelectField
            label={t("reason")}
            value={state.reasonKey}
            required
            fullWidth
            error={invalid.includes("reasonKey")}
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
        </Stack>
        <TextField
          label={t("note")}
          value={state.note}
          required={state.reasonKey === "other"}
          fullWidth
          error={invalid.includes("note")}
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
 * 補打卡申請的新增 / 編輯頁(SC-13;規格 14.8;替換表單引擎的新增頁與編輯頁):日期、分店、**對應排班(必選)**、
 * 類型、時間、原因。對應排班 = 選了日期與分店後列出本人當天在那家店的排班,最後一個是「沒有排班(臨時代班)」;
 * 改了日期或分店就清空重選。沒有草稿(送出即進審核)。新增頁的帶入值在網址;編輯頁(被退回 / 撤回)
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
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
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
        initial={makeupPunchStateOf(submission.values, timezone)}
        isPending={existing.isPending}
        errorText={existing.error === null ? null : errorText(existing.error)}
        notice={
          submission.status === FormSubmissionStatus.Returned
            ? t("returnedHint")
            : null
        }
        onSubmit={(state) => {
          void existing
            .submit(makeupPunchStoredValues(state, timezone))
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
        void draft
          .submit(makeupPunchStoredValues(state, timezone), [])
          .then(afterSubmit);
      }}
      onCancel={leave}
    />
  );
};
