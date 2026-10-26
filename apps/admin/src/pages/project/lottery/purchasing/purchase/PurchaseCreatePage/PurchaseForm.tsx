import { type ReactNode, useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE, type StoredValues } from "@repo/domain/form";
import { purchaseRedemptionTotalsOf } from "@repo/domain/project/lottery";
import { useLotteryPurchaseOptionsQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import { AllocationWarnings } from "@/components/project/lottery/AllocationWarnings/AllocationWarnings";
import type { AllocationWarningItem } from "@/components/project/lottery/AllocationWarnings/allocation-warnings";
import {
  BookGroupList,
  type BookListGroup,
  type BookListLabels,
} from "@/components/project/lottery/BookGroupList/BookGroupList";
import { BookScanBar } from "@/components/project/lottery/BookScanBar/BookScanBar";
import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import type { FormError } from "@/lib/base/form-engine/form-errors";
import {
  localDayInstantOf,
  localDayTextOf,
} from "@/lib/base/form-engine/local-day";

import { LineErrorAlerts } from "../../shared/LineErrorAlerts";
import { PURCHASE_FIELD_KEYS, formatMoney } from "../purchase-keys";
import {
  type PurchaseHeaderDraft,
  PurchaseHeaderFields,
} from "./PurchaseHeaderFields";
import { PurchaseRedemptions } from "./PurchaseRedemptions";
import { PurchaseTotals } from "./PurchaseTotals";
import {
  type PickedRedemption,
  type PurchaseFormState,
  type PurchaseGame,
  defaultAccountOf,
  groupBooks,
  purchaseTotalOf,
  purchaseValuesOf,
  requisitionProgressOf,
  toggleRedemption,
} from "./purchase-form";
import { usePurchaseBooks } from "./usePurchaseBooks";

/** 掃描用途(B10;新增 / 編輯頁刷條碼加一本)。 */
export const PURCHASE_CREATE_SCAN_PURPOSE = "purchase-create";

export interface PurchaseFormProps {
  /** `create` 新增頁;`edit` 編輯頁(草稿 / 被退回) */
  mode: "create" | "edit";
  /** 編輯中的那一筆(叫貨單 / 兌獎紀錄的選項另含它已引用的);新增 = null */
  submissionId: string | null;
  title: string;
  /** 帶入的內容(新增頁 = 預設值與網址帶入) */
  initial: PurchaseFormState;
  /** 鎖住的列(已點收;編輯頁) */
  lockedRowIds: ReadonlySet<string>;
  /** 點收區塊讀到的遊戲(鎖住的列的遊戲若已停售,用它補,列才不會消失) */
  extraGames: readonly PurchaseGame[];
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
 * 進貨單的新增 / 編輯畫面(專案規格 8.2;Figma PU-05 電腦 127:2224、平板 127:26493、手機 127:26791):
 * 單頭 → 明細(`BookGroupList`:依遊戲分組;從叫貨單帶入時「叫貨 5,已刷 4」;批購金額率逐本 / 整組改,改過的列標色;
 * 刷條碼列 `BookScanBar` 一直顯示「正面條碼的遊戲」)→ 兌獎 → 合計 → [存草稿] [送出]。
 * 編輯頁(草稿 / 被退回)帶入原內容:已點收的列鎖住(不能刪、不能改率)並標「已點收」,組標題加「已點收 X / N」;
 * 沒點收的列照新增頁可改可刪、可再刷新的本。有已點收的本時進貨分店也鎖住(換分店會清掉明細)。
 */
export const PurchaseForm = ({
  mode,
  submissionId,
  title,
  initial,
  lockedRowIds,
  extraGames,
  notice,
  canSaveDraft,
  isPending,
  error,
  onSaveDraft,
  onSubmit,
  onCancel,
}: PurchaseFormProps) => {
  const t = useTranslations("admin.lotteryPurchasing.purchase.create");
  const tEdit = useTranslations("admin.lotteryPurchasing.purchase.edit");
  const tReceive = useTranslations("admin.lotteryPurchasing.receive");
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const { session } = useSession();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const [header, setHeader] = useState<PurchaseHeaderDraft>(() => ({
    ...initial.header,
    purchaseDay: localDayTextOf(initial.header.purchaseDate, timezone),
  }));
  const branchId = header.branchId;
  const purchaseBooks = usePurchaseBooks(initial.books, lockedRowIds);
  const { books } = purchaseBooks;
  const [fallbackGameId, setFallbackGameId] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [redemptions, setRedemptions] = useState<PickedRedemption[]>(
    initial.redemptions,
  );

  const options = useLotteryPurchaseOptionsQuery(
    session.client,
    { orgId: branchId, submissionId },
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
  const groups = groupBooks(books, games, requested, extraGames);
  const total = purchaseTotalOf(groups);
  const progress = requisitionProgressOf(groups);
  const totals = purchaseRedemptionTotalsOf(
    total,
    redemptions.reduce((sum, item) => sum + item.prizeAmount, 0),
  );
  const hasLocked = books.some((book) => lockedRowIds.has(book.rowId));
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

  const scan = (raw: string): boolean => {
    if (branchId === "") {
      return false;
    }
    const result = purchaseBooks.add(raw, games, fallbackGameId);
    if (result.kind === "added") {
      setScanError(null);
      return true;
    }
    setScanError(
      t(`scanErrors.${result.kind}`, {
        gameCode: result.kind === "unknown_game" ? result.gameCode : "",
        bookNo: result.kind === "duplicate" ? result.bookNo : "",
      }),
    );
    return false;
  };

  const listGroups: BookListGroup[] = groups.map((group) => {
    const received = group.rows.filter((row) =>
      lockedRowIds.has(row.rowId),
    ).length;
    const captions = [
      group.requestedBooks === null
        ? null
        : t("requested", {
            requested: group.requestedBooks,
            scanned: group.rows.length,
          }),
      mode === "edit" && received > 0
        ? tReceive("receivedOf", { received, total: group.rows.length })
        : null,
    ].filter((item) => item !== null);
    return {
      key: group.game.id,
      title: t("groupTitle", {
        code: group.game.gameCode,
        name: group.game.name,
        price: group.game.unitPrice,
        books: group.rows.length,
        subtotal: formatMoney(group.subtotal),
      }),
      caption: captions.length === 0 ? null : captions.join(" · "),
      rows: group.rows.map((row) => {
        const isLocked = lockedRowIds.has(row.rowId);
        return {
          rowId: row.rowId,
          bookNo: row.displayBookNo,
          ticketText: String(row.lastTicketNo).padStart(3, "0"),
          tickets: row.tickets,
          bookPrice: row.bookPrice,
          rate: row.rate,
          amount: row.amount,
          isRateEdited: row.isRateEdited,
          isLocked,
          status: isLocked ? "received" : null,
        };
      }),
      groupRate: {
        value:
          purchaseBooks.groupRates.get(group.game.id) ?? group.game.defaultRate,
        label: t("groupRateOf", { code: group.game.gameCode }),
        onChange: (rate: number) => {
          purchaseBooks.setGroupRate(group.game.id, rate);
        },
      },
    };
  });
  const labels: BookListLabels = {
    columns: {
      bookNo: t("columns.bookNo"),
      ticket: t("columns.lastTicketNo"),
      tickets: t("columns.tickets"),
      bookPrice: t("columns.bookPrice"),
      rate: t("columns.rate"),
      amount: t("columns.amount"),
      status: tReceive("columns.status"),
    },
    status: {
      received: tReceive("received"),
      notReceived: tReceive("notReceived"),
      inTransit: tReceive("inTransit"),
    },
    remove: t("remove"),
    rateOf: (row) => t("rateOf", { bookNo: row.bookNo }),
    groupRate: t("groupRate"),
    cardFacts: (row) =>
      t("cardFacts", {
        lastTicketNo: row.ticketText,
        amount: formatMoney(row.amount),
      }),
    empty: branchId === "" ? t("pickBranch") : t("empty"),
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
              {title}
            </Typography>
            {progress !== null && requisitionNo !== null && (
              <Typography variant="body2" color="textSecondary">
                {t("fromRequisition", {
                  serialNo: requisitionNo,
                  requested: progress.requested,
                  scanned: progress.scanned,
                })}
              </Typography>
            )}
          </Stack>
          {notice}
          <PurchaseHeaderFields
            value={{ ...header, accountId }}
            options={data}
            error={error}
            isBranchLocked={hasLocked}
            onChange={(patch) => {
              setHeader((current) => ({ ...current, ...patch }));
            }}
            onBranchChange={(next) => {
              setHeader((current) => ({
                ...current,
                branchId: next,
                requisitionNo: null,
                accountId: null,
              }));
              purchaseBooks.reset();
              setRedemptions([]);
            }}
          />
          <BookGroupList
            mode={mode}
            title={t("lines")}
            groups={branchId === "" ? [] : listGroups}
            labels={labels}
            scanBar={
              <BookScanBar
                purpose={PURCHASE_CREATE_SCAN_PURPOSE}
                label={t("scan")}
                disabled={branchId === ""}
                onScan={scan}
                gamePicker={{
                  label: t("fallbackGame"),
                  noneLabel: t("fallbackGameNone"),
                  options: games.map((game) => ({
                    value: game.id,
                    label: `${game.gameCode} ${game.name}`,
                  })),
                  value: fallbackGameId,
                  onChange: setFallbackGameId,
                }}
                message={
                  scanError === null
                    ? null
                    : { severity: "warning", text: scanError }
                }
              />
            }
            notice={
              <>
                {hasLocked && (
                  <Alert severity="info">{tEdit("lockedHint")}</Alert>
                )}
                <AllocationWarnings items={allocationItems} />
                <LineErrorAlerts
                  error={error}
                  fieldKey={PURCHASE_FIELD_KEYS.lines}
                />
              </>
            }
            onRate={purchaseBooks.setRate}
            onRemove={purchaseBooks.remove}
          />
          <PurchaseRedemptions
            branchId={branchId}
            submissionId={submissionId}
            error={error}
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
          {error !== null && <Alert severity="error">{errorText(error)}</Alert>}
        </Stack>
      </Box>
      <FormActions
        cancel={{ label: t("cancel"), onClick: onCancel }}
        {...(canSaveDraft && {
          draft: {
            label: t("saveDraft"),
            disabled: isPending || branchId === "",
            onClick: () => {
              onSaveDraft(valuesOf());
            },
          },
        })}
        submit={{
          label: t("submit"),
          disabled: isPending || branchId === "" || books.length === 0,
          onClick: () => {
            onSubmit(valuesOf());
          },
        }}
      />
    </Stack>
  );
};
