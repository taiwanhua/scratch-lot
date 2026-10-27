import { type ReactNode, useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, type StoredValues } from "@repo/domain/form";
import { useLotteryRequisitionCandidatesQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Checkbox } from "@repo/ui/checkbox";
import { DatePicker } from "@repo/ui/date-picker";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import type { FormError } from "@/lib/base/form-engine/form-errors";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";

import { REQUISITION_FIELD_KEYS, formatCount } from "../purchasing-keys";
import { LineErrorAlerts } from "../shared/LineErrorAlerts";
import { fieldErrorProps } from "../shared/field-errors";
import { CandidateCards } from "./CandidateCards";
import { CandidateTable } from "./CandidateTable";
import {
  type BookCounts,
  type CandidateFilters,
  EMPTY_FILTERS,
  type RequisitionFormState,
  parseBooks,
  requisitionValuesOf,
  totalsOf,
  unitPricesOf,
  visibleCandidates,
} from "./requisition-form";

const ALL = "all";

export interface RequisitionFormProps {
  title: string;
  /** 帶入的內容(新增頁 = 預設分店;編輯頁 = 原內容) */
  initial: RequisitionFormState;
  /** 標題下的提示(例 被退回的說明) */
  notice?: ReactNode;
  canSaveDraft: boolean;
  isPending: boolean;
  error: FormError | null;
  onSaveDraft: (values: StoredValues) => void;
  onSubmit: (values: StoredValues) => void;
  onCancel: () => void;
}

/**
 * 叫貨單的新增 / 編輯畫面(規格 8.1;Figma PU-02 電腦 69:15、平板 127:26386、手機 127:26700):
 * 叫貨分店、期望到貨日 → 所有販售中的遊戲(目前庫存、在途、近 7 / 30 天、叫幾本)→ 共叫幾本與預估批購金額、
 * [存草稿] [送出]。0 本的列不寫入;超過預計要給本數只提醒。編輯頁(草稿 / 被退回)帶入原內容:
 * 每個遊戲的本數與 rowId 照舊,明細備註、單頭備註原樣保留;不在販售中的遊戲列不出來,原樣保留並提示。
 */
export const RequisitionForm = ({
  title,
  initial,
  notice,
  canSaveDraft,
  isPending,
  error,
  onSaveDraft,
  onSubmit,
  onCancel,
}: RequisitionFormProps) => {
  const t = useTranslations("admin.lotteryPurchasing.create");
  const tEdit = useTranslations("admin.lotteryPurchasing.edit");
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const { session } = useSession();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const isNarrow = useBreakpointDown("lg");
  const [branchId, setBranchId] = useState(initial.branchId);
  const [expectedDay, setExpectedDay] = useState<string | null>(() =>
    localDayTextOf(initial.expectedDate, timezone),
  );
  const [filters, setFilters] = useState<CandidateFilters>(EMPTY_FILTERS);
  const [counts, setCounts] = useState<BookCounts>(initial.counts);
  // 每個遊戲一個固定的 rowId(存草稿後再送出時同一列不換 id;編輯頁沿用原本的)
  const [rowIds] = useState(() => new Map(initial.rowIds));
  const rowIdOf = (gameId: string): string => {
    const existing = rowIds.get(gameId);
    if (existing !== undefined) {
      return existing;
    }
    const created = crypto.randomUUID();
    rowIds.set(gameId, created);
    return created;
  };

  const candidates = useLotteryRequisitionCandidatesQuery(
    session.client,
    { orgId: branchId },
    { enabled: branchId !== "" },
  );
  const rows = useMemo(
    () => candidates.data?.lotteryRequisitionCandidates ?? [],
    [candidates.data],
  );
  const visible = visibleCandidates(rows, counts, filters);
  const totals = totalsOf(rows, counts);
  const setBooks = (gameId: string, raw: string) => {
    setCounts((current) => ({ ...current, [gameId]: parseBooks(raw) }));
  };

  // 帶入的列裡、不在販售中遊戲清單的(停售):原樣保留,提示一次;換了分店就不帶
  const kept = initial.otherLines.filter(
    (line) =>
      branchId === initial.branchId &&
      !rows.some((row) => row.gameId === line.gameId),
  );
  const valuesOf = () =>
    requisitionValuesOf(
      {
        branchId,
        expectedDate: localDayInstantOf(expectedDay, timezone),
      },
      rows,
      counts,
      rowIdOf,
      {
        note: initial.note,
        lineNotes: initial.lineNotes,
        otherLines: candidates.isSuccess ? kept : [],
      },
    );

  const filtersRow = (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={1.5}
      sx={{ alignItems: { sm: "center" } }}
    >
      <TextField
        label={t("filters.keyword")}
        size="small"
        value={filters.keyword}
        onChange={(event) => {
          setFilters((current) => ({
            ...current,
            keyword: event.target.value,
          }));
        }}
        sx={{ flex: { sm: 1 }, maxWidth: { lg: 280 } }}
      />
      <SelectField<string>
        label={t("filters.unitPrice")}
        size="small"
        value={filters.unitPrice === null ? ALL : String(filters.unitPrice)}
        options={[
          { value: ALL, label: t("filters.all") },
          ...unitPricesOf(rows).map((price) => ({
            value: String(price),
            label: t("unitPrice", { price: formatCount(price) }),
          })),
        ]}
        onChange={(next) => {
          setFilters((current) => ({
            ...current,
            unitPrice: next === ALL ? null : Number(next),
          }));
        }}
        sx={{ minWidth: 140, flex: { sm: 1, lg: "none" } }}
      />
      <FormControlLabel
        label={t("filters.onlyOrdered")}
        control={
          <Checkbox
            checked={filters.onlyOrdered}
            onChange={(event) => {
              setFilters((current) => ({
                ...current,
                onlyOrdered: event.target.checked,
              }));
            }}
          />
        }
      />
    </Stack>
  );

  let list = (
    <Typography variant="body2" color="textSecondary">
      {t("pickBranch")}
    </Typography>
  );
  if (branchId !== "") {
    list = isNarrow ? (
      <CandidateCards
        rows={visible}
        counts={counts}
        isLoading={candidates.isLoading}
        onChangeBooks={setBooks}
      />
    ) : (
      <CandidateTable
        rows={visible}
        counts={counts}
        isLoading={candidates.isLoading}
        onChangeBooks={setBooks}
      />
    );
  }

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Stack spacing={2}>
          <Typography variant="h6" component="h1">
            {title}
          </Typography>
          {notice}
          {candidates.isSuccess && kept.length > 0 && (
            <Alert severity="warning">
              {tEdit("notOnSale", {
                games: kept.map((line) => line.label).join("、"),
              })}
            </Alert>
          )}
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "1fr",
                sm: "1fr 1fr",
                lg: "320px 220px",
              },
            }}
          >
            <OrgTreeSelect
              scope="visible"
              label={t("fields.branch")}
              size="small"
              value={branchId === "" ? [] : [branchId]}
              required
              fullWidth
              {...fieldErrorProps(error, REQUISITION_FIELD_KEYS.branch)}
              onChange={(ids) => {
                setBranchId(ids[0] ?? "");
                setCounts({});
              }}
            />
            <DatePicker
              label={t("fields.expectedDate")}
              size="small"
              value={expectedDay}
              fullWidth
              onChange={setExpectedDay}
              {...fieldErrorProps(error, REQUISITION_FIELD_KEYS.expectedDate)}
            />
          </Box>
          <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Stack spacing={2}>
              {filtersRow}
              <LineErrorAlerts
                error={error}
                fieldKey={REQUISITION_FIELD_KEYS.lines}
              />
              {list}
            </Stack>
          </Card>
          {error !== null && <Alert severity="error">{errorText(error)}</Alert>}
        </Stack>
      </Box>
      <FormActions
        start={
          <Typography
            variant="subtitle1"
            component="p"
            sx={{ fontWeight: 700 }}
          >
            {isNarrow
              ? t("totalsShort", {
                  books: totals.books,
                  amount: formatCount(totals.amount),
                })
              : t("totals", {
                  books: totals.books,
                  amount: formatCount(totals.amount),
                })}
          </Typography>
        }
        cancel={{ label: t("cancel"), onClick: onCancel }}
        {...(canSaveDraft && {
          draft: {
            label: t("saveDraft"),
            // 遊戲清單讀到之前不能存(本數要對到清單上的遊戲才寫入)
            disabled: isPending || branchId === "" || !candidates.isSuccess,
            onClick: () => {
              onSaveDraft(valuesOf());
            },
          },
        })}
        submit={{
          label: t("submit"),
          disabled:
            isPending ||
            branchId === "" ||
            !candidates.isSuccess ||
            totals.books === 0,
          onClick: () => {
            onSubmit(valuesOf());
          },
        }}
      />
    </Stack>
  );
};
