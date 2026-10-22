import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { useLotteryRequisitionCandidatesQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { Checkbox } from "@repo/ui/checkbox";
import { CircularProgress } from "@repo/ui/circular-progress";
import { DatePicker } from "@repo/ui/date-picker";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useFormDraft } from "@/hooks/base/useFormDraft";
import { useMe } from "@/hooks/base/useMe";
import { useModuleForms } from "@/hooks/base/useModuleForms";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { localDayInstantOf } from "@/lib/base/form-engine/local-day";

import {
  REQUISITION_FIELD_KEYS,
  REQUISITION_FORM_KEY,
  REQUISITION_MODULE_KEY,
  formatCount,
} from "../purchasing-keys";
import { LineErrorAlerts } from "../shared/LineErrorAlerts";
import { fieldErrorProps } from "../shared/field-errors";
import { CandidateCards } from "./CandidateCards";
import { CandidateTable } from "./CandidateTable";
import {
  type BookCounts,
  type CandidateFilters,
  EMPTY_FILTERS,
  parseBooks,
  requisitionValuesOf,
  totalsOf,
  unitPricesOf,
  visibleCandidates,
} from "./requisition-form";

const ALL = "all";

/**
 * 叫貨單的替換新增頁(規格 8.1;Figma PU-02 電腦 69:15、平板 127:26386、手機 127:26700):
 * 叫貨分店(店長預設自己的分店,總部從可見分店選)、期望到貨日 → 所有販售中的遊戲(目前庫存、在途、
 * 近 7 / 30 天、叫幾本)→ 共叫幾本與預估批購金額、[存草稿] [送出]。
 * 0 本的列不寫入;超過預計要給本數只提醒。存值交給表單引擎(`useFormDraft`),流程與掛接點照常。
 */
export const RequisitionCreatePage = () => {
  const t = useTranslations("admin.lotteryPurchasing.create");
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const showSnackbar = useSnackbar();
  const { session } = useSession();
  const me = useMe();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const isNarrow = useBreakpointDown("lg");
  const access = useFormModuleAccess(REQUISITION_MODULE_KEY);
  const { creatableForms, isLoading: isFormsLoading } = useModuleForms(
    REQUISITION_MODULE_KEY,
  );
  const form = creatableForms.find((item) => item.key === REQUISITION_FORM_KEY);
  const draft = useFormDraft(REQUISITION_FORM_KEY);
  useRouteTabItemLabel(t("tabLabel"));

  // 店長預設自己的分店;當前組織是最上層組織(總部)或根組織時不預設,從可見分店選
  const currentOrg = me.data?.me.currentOrg;
  const defaultBranch =
    currentOrg?.tenantId == null || currentOrg.tenantId === currentOrg.id
      ? ""
      : currentOrg.id;
  const [pickedBranch, setPickedBranch] = useState<string | null>(null);
  const branchId = pickedBranch ?? defaultBranch;
  const [expectedDay, setExpectedDay] = useState<string | null>(null);
  const [filters, setFilters] = useState<CandidateFilters>(EMPTY_FILTERS);
  const [counts, setCounts] = useState<BookCounts>({});
  // 每個遊戲一個固定的 rowId(存草稿後再送出時同一列不換 id)
  const [rowIds] = useState(() => new Map<string, string>());
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

  const backToList = () => {
    if (access.listRoute !== null) {
      void navigate(tabHref(access.listRoute));
    }
  };
  const valuesOf = () =>
    requisitionValuesOf(
      {
        branchId,
        expectedDate: localDayInstantOf(expectedDay, timezone),
      },
      rows,
      counts,
      rowIdOf,
    );

  if (isFormsLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (form === undefined) {
    return <Alert severity="error">{t("unavailable")}</Alert>;
  }

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
            {t("title")}
          </Typography>
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
              {...fieldErrorProps(draft.error, REQUISITION_FIELD_KEYS.branch)}
              onChange={(ids) => {
                setPickedBranch(ids[0] ?? "");
                setCounts({});
              }}
            />
            <DatePicker
              label={t("fields.expectedDate")}
              size="small"
              value={expectedDay}
              fullWidth
              onChange={setExpectedDay}
              {...fieldErrorProps(
                draft.error,
                REQUISITION_FIELD_KEYS.expectedDate,
              )}
            />
          </Box>
          <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Stack spacing={2}>
              {filtersRow}
              <LineErrorAlerts
                error={draft.error}
                fieldKey={REQUISITION_FIELD_KEYS.lines}
              />
              {list}
            </Stack>
          </Card>
          {draft.error !== null && (
            <Alert severity="error">{errorText(draft.error)}</Alert>
          )}
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
        cancel={{ label: t("cancel"), onClick: backToList }}
        {...(form.allowDraft && {
          draft: {
            label: t("saveDraft"),
            disabled: draft.isPending || branchId === "",
            onClick: () => {
              void draft.saveDraft(valuesOf(), []).then((saved) => {
                if (saved !== null) {
                  showSnackbar("success", t("draftSaved"));
                }
              });
            },
          },
        })}
        submit={{
          label: t("submit"),
          disabled: draft.isPending || branchId === "" || totals.books === 0,
          onClick: () => {
            void draft.submit(valuesOf(), []).then((submitted) => {
              if (submitted === null) {
                return;
              }
              showSnackbar("success", t("submitted"));
              if (access.viewRoute === null) {
                backToList();
              } else {
                void navigate(`${access.viewRoute}/${submitted.id}`);
              }
            });
          },
        }}
      />
    </Stack>
  );
};
