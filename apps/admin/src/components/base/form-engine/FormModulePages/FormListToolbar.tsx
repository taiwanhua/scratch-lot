import { useTranslations } from "use-intl";

import { FormSubmissionStatus } from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Tooltip } from "@repo/ui/tooltip";

import { DateFilterPicker } from "@/components/base/DateFilterPicker/DateFilterPicker";
import { FilterDrawer } from "@/components/base/FilterDrawer/FilterDrawer";
import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import type { ModuleFormSummary } from "@/hooks/base/useModuleForms";

/** 篩選列的條件(搜尋框之外);日期是當地日期 `YYYY-MM-DD`,含頭尾。 */
export interface FormListFilterValues {
  formKey: string | null;
  status: FormSubmissionStatus | null;
  /** 歸屬組織(含下層);null = 不篩 */
  orgId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

/** 抽屜的 [清除]:全部不篩。 */
const EMPTY_FORM_LIST_FILTERS: FormListFilterValues = {
  formKey: null,
  status: null,
  orgId: null,
  dateFrom: null,
  dateTo: null,
};

export interface FormListToolbarProps {
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  forms: readonly ModuleFormSummary[];
  filters: FormListFilterValues;
  /** 電腦版每改一欄就回呼;平板 / 手機在抽屜按 [套用] 才回呼 */
  onFiltersChange: (filters: FormListFilterValues) => void;
  /** 綁了新增頁且有 `create` 才出現新增鈕 */
  canCreate: boolean;
  /** 此刻沒有可新增的表單(停用、收回、退役)→ 新增鈕停用並附原因 */
  hasForms: boolean;
  onCreate: () => void;
}

const ALL = "" as const;

/** 狀態篩選的七值(`docs/concepts/workflow-engine.md`「提交的七個狀態」),依生命週期排。 */
const STATUS_ORDER: readonly FormSubmissionStatus[] = [
  FormSubmissionStatus.Draft,
  FormSubmissionStatus.Reviewing,
  FormSubmissionStatus.Returned,
  FormSubmissionStatus.Withdrawn,
  FormSubmissionStatus.Completed,
  FormSubmissionStatus.Rejected,
  FormSubmissionStatus.Voided,
];

type StatusFilter = typeof ALL | FormSubmissionStatus;

/** 電腦版篩選列的欄寬;抽屜裡(lg 以下)欄位撐滿 */
const widthOf = (width: number) => ({ width: { xs: "100%", lg: width } });

const activeCountOf = (filters: FormListFilterValues): number =>
  Object.values(filters).filter((value) => value !== null).length;

/**
 * 表單模組列表的工具列:搜尋(摘要標題)、依表單 / 狀態 / 組織 / 日期區間篩選、新增。
 * 篩選走 `FilterDrawer`(RW-01 / RW-01b):電腦攤在列上、改了立刻套用;平板 / 手機收進 [篩選 (N)] 抽屜,
 * 搜尋框一直在外面。組織是可見範圍(REACT-15 用法表 ⑤,單選、不給 = 全部);日期比對摘要槽「日期」。
 */
export const FormListToolbar = ({
  keyword,
  onKeywordChange,
  forms,
  filters,
  onFiltersChange,
  canCreate,
  hasForms,
  onCreate,
}: FormListToolbarProps) => {
  const t = useTranslations("admin.formEngine.pages");
  const tStatus = useTranslations("admin.approval.submissionStatus");

  const renderFields = (
    value: FormListFilterValues,
    change: (next: FormListFilterValues) => void,
  ) => (
    <>
      <SelectField
        label={t("formFilter")}
        value={value.formKey ?? ALL}
        displayEmpty
        size="small"
        sx={widthOf(200)}
        options={[
          { value: ALL, label: t("allForms") },
          ...forms.map((form) => ({ value: form.key, label: form.name })),
        ]}
        onChange={(next) => {
          change({ ...value, formKey: next === ALL ? null : next });
        }}
      />
      <SelectField<StatusFilter>
        label={t("statusFilter")}
        value={value.status ?? ALL}
        displayEmpty
        size="small"
        sx={widthOf(180)}
        options={[
          { value: ALL, label: t("allStatuses") },
          ...STATUS_ORDER.map((status) => ({
            value: status,
            label: tStatus(status),
          })),
        ]}
        onChange={(next) => {
          change({ ...value, status: next === ALL ? null : next });
        }}
      />
      <Box sx={widthOf(220)}>
        <OrgTreeSelect
          scope="visible"
          label={t("orgFilter")}
          value={value.orgId === null ? [] : [value.orgId]}
          size="small"
          fullWidth
          onChange={(ids) => {
            change({ ...value, orgId: ids[0] ?? null });
          }}
        />
      </Box>
      <Box sx={widthOf(170)}>
        <DateFilterPicker
          label={t("dateFrom")}
          value={value.dateFrom}
          size="small"
          fullWidth
          onChange={(next) => {
            change({ ...value, dateFrom: next });
          }}
        />
      </Box>
      <Box sx={widthOf(170)}>
        <DateFilterPicker
          label={t("dateTo")}
          value={value.dateTo}
          size="small"
          fullWidth
          onChange={(next) => {
            change({ ...value, dateTo: next });
          }}
        />
      </Box>
    </>
  );

  return (
    <Stack
      direction="row"
      useFlexGap
      spacing={1.5}
      sx={{ alignItems: "flex-start" }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <FilterDrawer
          value={filters}
          emptyValue={EMPTY_FORM_LIST_FILTERS}
          activeCount={activeCountOf(filters)}
          onApply={onFiltersChange}
          renderFields={renderFields}
          search={
            <TextField
              label={t("search")}
              placeholder={t("searchPlaceholder")}
              size="small"
              value={keyword}
              sx={{ width: { xs: "100%", sm: 240 }, minWidth: 0 }}
              onChange={(event) => {
                onKeywordChange(event.target.value);
              }}
            />
          }
        />
      </Box>
      {canCreate && (
        <Tooltip title={hasForms ? "" : t("noFormsHint")}>
          <Button
            disabled={!hasForms}
            sx={{ flexShrink: 0 }}
            onClick={onCreate}
          >
            {t("create")}
          </Button>
        </Tooltip>
      )}
    </Stack>
  );
};
