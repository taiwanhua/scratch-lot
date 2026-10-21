import { type KeyboardEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { purchaseRedemptionTotalsOf } from "@repo/domain/project/lottery";
import { useLotteryPurchaseOptionsQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { AllocationWarnings } from "@/components/project/lottery/AllocationWarnings/AllocationWarnings";
import type { AllocationWarningItem } from "@/components/project/lottery/AllocationWarnings/allocation-warnings";
import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useFormDraft } from "@/hooks/base/useFormDraft";
import { useMe } from "@/hooks/base/useMe";
import { useModuleForms } from "@/hooks/base/useModuleForms";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";
import { useScanner } from "@/hooks/project/useScanner/useScanner";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";

import {
  PURCHASE_FORM_KEY,
  PURCHASE_FROM_REQUISITION,
  PURCHASE_MODULE_KEY,
} from "../purchase-keys";
import {
  type PurchaseHeaderDraft,
  PurchaseHeaderFields,
} from "./PurchaseHeaderFields";
import { PurchaseLines } from "./PurchaseLines";
import { PurchaseRedemptions } from "./PurchaseRedemptions";
import { PurchaseTotals } from "./PurchaseTotals";
import {
  type PickedRedemption,
  defaultAccountOf,
  groupBooks,
  purchaseTotalOf,
  purchaseValuesOf,
  requisitionProgressOf,
  toggleRedemption,
} from "./purchase-form";
import { usePurchaseBooks } from "./usePurchaseBooks";

const NONE = "none";

/** 帶入的值(空字串 = 沒帶)。 */
const fromSchema = z.string().default("");

/** 掃描用途(B10;新增頁刷條碼加一本)。 */
export const PURCHASE_CREATE_SCAN_PURPOSE = "purchase-create";

/**
 * 進貨單的替換新增頁(專案規格 8.2;Figma PU-05 電腦 127:2224、平板 127:26493、手機 127:26791):
 * 單頭(進貨分店、叫貨單、批購甲類、本人批購、批購受託人、批購日期、扣款帳戶、備註)→ 刷條碼加一本
 * (依遊戲分組;從叫貨單帶入時顯示「叫貨 5,已刷 4」;批購金額率逐本 / 整組改,改過的列標色)→ 合計、
 * [存草稿] [送出]。存值交給表單引擎(`useFormDraft`),送出前的檢查在 api 的掛接點。
 * 兌獎區(`PurchaseRedemptions`):勾選進貨分店店內持有的兌獎紀錄,合計多三列(兌獎金額 / 兌獎折抵 / 兌獎剩餘),
 * 扣款金額 = 批購合計 − 兌獎折抵。從採購清單 [建立進貨單] 進來時帶 `?requisition=<單號>&branch=<分店>`。
 */
export const PurchaseCreatePage = () => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.create");
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const showSnackbar = useSnackbar();
  const { session } = useSession();
  const me = useMe();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const isNarrow = useBreakpointDown("lg");
  const access = useFormModuleAccess(PURCHASE_MODULE_KEY);
  const { creatableForms, isLoading: isFormsLoading } =
    useModuleForms(PURCHASE_MODULE_KEY);
  const form = creatableForms.find((item) => item.key === PURCHASE_FORM_KEY);
  const draft = useFormDraft(PURCHASE_FORM_KEY);
  useRouteTabItemLabel(t("tabLabel"));

  // 從採購清單 [建立進貨單] 帶入的叫貨單單號與分店(網址;只在打開時讀)
  const [fromRequisition] = useUrlState(
    PURCHASE_FROM_REQUISITION.requisition,
    fromSchema,
  );
  const [fromBranch] = useUrlState(
    PURCHASE_FROM_REQUISITION.branch,
    fromSchema,
  );
  // 進貨分店:帶入的分店優先;店長預設自己的分店;最上層組織(總部)不預設
  const currentOrg = me.data?.me.currentOrg;
  const isHeadquarters =
    currentOrg?.tenantId == null || currentOrg.tenantId === currentOrg.id;
  const ownBranch = isHeadquarters ? "" : currentOrg.id;
  const defaultBranch = fromBranch === "" ? ownBranch : fromBranch;
  const [edited, setEdited] = useState<Partial<PurchaseHeaderDraft>>({});
  const [initialDay] = useState(() => localDayTextOf(new Date(), timezone));
  const header: PurchaseHeaderDraft = {
    branchId: defaultBranch,
    requisitionNo: fromRequisition === "" ? null : fromRequisition,
    dealerId: null,
    selfPurchase: true,
    trusteeId: null,
    // 批購日期預設今天(租戶時區)
    purchaseDay: initialDay,
    accountId: null,
    note: "",
    ...edited,
  };
  const branchId = header.branchId;
  const purchaseBooks = usePurchaseBooks();
  const { books } = purchaseBooks;
  const [code, setCode] = useState("");
  const [fallbackGameId, setFallbackGameId] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [redemptions, setRedemptions] = useState<PickedRedemption[]>([]);

  const options = useLotteryPurchaseOptionsQuery(
    session.client,
    { orgId: branchId },
    { enabled: branchId !== "" },
  );
  const data = options.data?.lotteryPurchaseOptions ?? null;
  const games = useMemo(() => data?.games ?? [], [data]);
  const accountId = header.accountId ?? defaultAccountOf(data?.accounts ?? []);
  const requisitionNo = header.requisitionNo;
  const requisition =
    data?.requisitions.find((item) => item.serialNo === requisitionNo) ?? null;
  const requested = useMemo(
    () =>
      requisition === null
        ? null
        : new Map(requisition.lines.map((line) => [line.gameId, line.books])),
    [requisition],
  );
  const groups = groupBooks(books, games, requested);
  const total = purchaseTotalOf(groups);
  const progress = requisitionProgressOf(groups);
  const totals = purchaseRedemptionTotalsOf(
    total,
    redemptions.reduce((sum, item) => sum + item.prizeAmount, 0),
  );
  // 超過進貨分店的預計要給本數只警告(規格 7.6)
  const allocationOf = new Map(
    (data?.allocations ?? []).map((item) => [item.gameId, item]),
  );
  const allocationItems: AllocationWarningItem[] = groups.flatMap((group) => {
    const allocation = allocationOf.get(group.game.id);
    return allocation === undefined || group.rows.length === 0
      ? []
      : [
          {
            key: group.game.id,
            label: `${group.game.gameCode} ${group.game.name}`,
            plannedBooks: allocation.plannedBooks ?? null,
            givenBooks: allocation.givenBooks,
            inTransitBooks: allocation.inTransitBooks,
            books: group.rows.length,
          },
        ];
  });

  const scan = (raw: string) => {
    const result = purchaseBooks.add(raw, games, fallbackGameId);
    if (result.kind === "added") {
      setScanError(null);
      setCode("");
      return;
    }
    setScanError(
      t(`scanErrors.${result.kind}`, {
        gameCode: result.kind === "unknown_game" ? result.gameCode : "",
        bookNo: result.kind === "duplicate" ? result.bookNo : "",
      }),
    );
  };
  useScanner(PURCHASE_CREATE_SCAN_PURPOSE, ({ code: scanned }) => {
    if (branchId !== "") {
      scan(scanned);
    }
  });
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && code.trim() !== "") {
      event.preventDefault();
      scan(code.trim());
    }
  };

  const valuesOf = () =>
    purchaseValuesOf(
      {
        branchId,
        requisitionNo: requisition === null ? null : requisitionNo,
        dealerId: header.dealerId,
        selfPurchase: header.selfPurchase,
        trusteeId: header.trusteeId,
        purchaseDate: localDayInstantOf(header.purchaseDay, timezone),
        accountId,
        note: header.note,
      },
      groups,
      redemptions,
    );
  const backToList = () => {
    if (access.listRoute !== null) {
      void navigate(tabHref(access.listRoute));
    }
  };

  if (isFormsLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (form === undefined) {
    return <Alert severity="error">{t("unavailable")}</Alert>;
  }

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            sx={{ alignItems: { sm: "baseline" } }}
          >
            <Typography variant="h6" component="h1">
              {t("title")}
            </Typography>
            {progress !== null && requisitionNo !== null && (
              <Typography variant="body2" color="text.secondary">
                {t("fromRequisition", {
                  serialNo: requisitionNo,
                  requested: progress.requested,
                  scanned: progress.scanned,
                })}
              </Typography>
            )}
          </Stack>
          <PurchaseHeaderFields
            value={{ ...header, accountId }}
            options={data}
            error={draft.error}
            onChange={(patch) => {
              setEdited((current) => ({ ...current, ...patch }));
            }}
            onBranchChange={(next) => {
              setEdited((current) => ({
                ...current,
                branchId: next,
                requisitionNo: null,
                accountId: null,
              }));
              purchaseBooks.reset();
              setRedemptions([]);
            }}
          />
          <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Stack spacing={2}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                sx={{ alignItems: { sm: "center" } }}
              >
                <Typography variant="subtitle1" component="h2" sx={{ flex: 1 }}>
                  {t("lines")}
                </Typography>
                <SelectField<string>
                  label={t("fallbackGame")}
                  size="small"
                  value={fallbackGameId ?? NONE}
                  disabled={branchId === ""}
                  options={[
                    { value: NONE, label: t("fallbackGameNone") },
                    ...games.map((game) => ({
                      value: game.id,
                      label: `${game.gameCode} ${game.name}`,
                    })),
                  ]}
                  onChange={(next) => {
                    setFallbackGameId(next === NONE ? null : next);
                  }}
                  sx={{ minWidth: 180 }}
                />
                <TextField
                  label={t("scan")}
                  size="small"
                  value={code}
                  disabled={branchId === ""}
                  onChange={(event) => {
                    setCode(event.target.value);
                  }}
                  onKeyDown={handleKey}
                  sx={{ width: { xs: "100%", sm: 280 } }}
                  slotProps={{
                    htmlInput: {
                      "data-scanner-field": PURCHASE_CREATE_SCAN_PURPOSE,
                    },
                  }}
                />
              </Stack>
              <AllocationWarnings items={allocationItems} />
              {scanError !== null && (
                <Alert severity="warning">{scanError}</Alert>
              )}
              {branchId === "" ? (
                <Typography variant="body2" color="text.secondary">
                  {t("pickBranch")}
                </Typography>
              ) : (
                <PurchaseLines
                  groups={groups}
                  isCompact={isNarrow}
                  error={draft.error}
                  groupRates={purchaseBooks.groupRates}
                  onRate={purchaseBooks.setRate}
                  onGroupRate={purchaseBooks.setGroupRate}
                  onRemove={purchaseBooks.remove}
                />
              )}
            </Stack>
          </Card>
          <PurchaseRedemptions
            branchId={branchId}
            error={draft.error}
            pickedIds={new Set(redemptions.map((item) => item.id))}
            onToggle={(row) => {
              setRedemptions((current) =>
                toggleRedemption(
                  current,
                  {
                    id: row.id,
                    label: row.ticketLabel,
                    prizeAmount: row.prizeAmount,
                  },
                  () => crypto.randomUUID(),
                ),
              );
            }}
          />
          <PurchaseTotals
            purchaseTotal={total}
            totals={totals}
            pickedCount={redemptions.length}
          />
          {draft.error !== null && (
            <Alert severity="error">{errorText(draft.error)}</Alert>
          )}
        </Stack>
      </Box>
      <FormActions
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
          disabled: draft.isPending || branchId === "" || books.length === 0,
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
