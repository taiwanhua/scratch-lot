import { type ReactNode, useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import type { StoredValues } from "@repo/domain/form";
import { WHOLESALE_MAX_LINES } from "@repo/domain/project/lottery";
import { useLotteryWholesaleOptionsQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import {
  BookGroupList,
  type BookListGroup,
} from "@/components/project/lottery/BookGroupList/BookGroupList";
import { BookScanBar } from "@/components/project/lottery/BookScanBar/BookScanBar";
import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useSession } from "@/hooks/base/useSession";
import type { FormError } from "@/lib/base/form-engine/form-errors";

import { LineErrorAlerts } from "../../shared/LineErrorAlerts";
import { useWholesaleListLabels } from "../useWholesaleListLabels";
import {
  WHOLESALE_FIELD_KEYS,
  WHOLESALE_PAYMENT_MODE,
  displayBookNo,
  formatMoney,
} from "../wholesale-keys";
import { WholesaleBookDialog } from "./WholesaleBookDialog";
import { WholesaleHeaderFields } from "./WholesaleHeaderFields";
import { WholesaleTotals } from "./WholesaleTotals";
import { useWholesaleChecks } from "./useWholesaleChecks";
import {
  type GroupRates,
  type WholesaleBookOption,
  type WholesaleDraftLine,
  type WholesaleFormState,
  type WholesaleHeaderState,
  addBooks,
  defaultAccountOf,
  draftTotalOf,
  groupLines,
  lineAmountOf,
  profitOf,
  removeLine,
  scanBook,
  setGameRate,
  setLineRate,
  wholesaleValuesOf,
} from "./wholesale-form";

/** 明細列的 rowId。 */
const newRowId = (): string => crypto.randomUUID();

/** 掃描用途(B10;新增 / 編輯頁刷條碼加入)。 */
export const WHOLESALE_CREATE_SCAN_PURPOSE = "wholesale-create";

export interface WholesaleFormProps {
  /** `create` 新增頁;`edit` 編輯頁(草稿 / 被退回 / 撤回) */
  mode: "create" | "edit";
  title: string;
  initial: WholesaleFormState;
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
 * 批售單的新增 / 編輯畫面(規格 21.3;Figma WS-02a 912:8747 / 920:10937 / 920:11616、WS-02b、WS-02c、WS-02e):
 * 單頭 → 明細(`BookGroupList`:依遊戲分組,批購金額率逐本 / 整組改、改過的標色;刷條碼列 `BookScanBar` 與
 * [從可批售的本加入])→ 合計(有成本權限另看得到原成本與預估獲利)→ [存草稿] [送出]。
 * 刷到不能批售的本,在刷條碼列下方當下寫原因;送出被擋(本不能批售)時逐列寫原因。
 */
export const WholesaleForm = ({
  mode,
  title,
  initial,
  notice,
  canSaveDraft,
  isPending,
  error,
  onSaveDraft,
  onSubmit,
  onCancel,
}: WholesaleFormProps) => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.create");
  const tEdit = useTranslations("admin.lotteryPurchasing.wholesale.edit");
  const tPurchase = useTranslations("admin.lotteryPurchasing.purchase.create");
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const { session } = useSession();
  const isCompact = useBreakpointDown("lg");
  const labels = useWholesaleListLabels();
  const [header, setHeader] = useState<WholesaleHeaderState>(initial.header);
  const [lines, setLines] = useState<WholesaleDraftLine[]>(initial.lines);
  const [groupRates, setGroupRates] = useState<GroupRates>(new Map());
  const [fallbackGameId, setFallbackGameId] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const { fromBranchId } = header;

  const options = useLotteryWholesaleOptionsQuery(
    session.client,
    { fromOrgId: fromBranchId },
    { enabled: fromBranchId !== "" },
  );
  const data = options.data?.lotteryWholesaleOptions ?? null;
  const books = useMemo(() => data?.books ?? [], [data]);
  const checks = useWholesaleChecks(fromBranchId, lines, error);
  const isAutoBank = header.paymentMode === WHOLESALE_PAYMENT_MODE.autoBank;
  const accountId = header.accountId ?? defaultAccountOf(data?.accounts ?? []);
  const total = draftTotalOf(lines);
  const games = [
    ...new Map(
      books.map((book) => [
        book.gameId,
        { value: book.gameId, label: `${book.gameCode} ${book.gameName}` },
      ]),
    ).values(),
  ];

  const add = (picked: readonly WholesaleBookOption[]) => {
    setLines((current) => addBooks(current, picked, groupRates, newRowId));
    setScanError(null);
  };

  const scan = async (raw: string): Promise<boolean> => {
    if (fromBranchId === "") {
      return false;
    }
    const result = scanBook(books, raw, fallbackGameId);
    switch (result.kind) {
      case "invalid": {
        setScanError(t("scanInvalid"));
        return false;
      }
      case "ambiguous": {
        setScanError(t("scanAmbiguousGame"));
        return false;
      }
      case "unavailable": {
        setScanError(
          await checks.explain(result.bookNo, result.gameCode, fallbackGameId),
        );
        return false;
      }
      case "found": {
        const { book } = result;
        if (lines.some((line) => line.book.bookId === book.bookId)) {
          setScanError(t("duplicate", { bookNo: displayBookNo(book.bookNo) }));
          return false;
        }
        add([book]);
        return true;
      }
    }
  };

  const groups: BookListGroup[] = groupLines(lines).map((group) => ({
    key: group.book.gameId,
    title: t("groupTitle", {
      code: group.book.gameCode,
      name: group.book.gameName,
      price: group.book.unitPrice,
      books: group.lines.length,
      subtotal: formatMoney(draftTotalOf(group.lines)),
    }),
    rows: group.lines.map((line) => ({
      rowId: line.rowId,
      bookNo: displayBookNo(line.book.bookNo),
      ticketText: "",
      tickets: line.book.tickets,
      bookPrice: line.book.bookPrice,
      rate: line.rate,
      amount: lineAmountOf(line),
      isRateEdited: line.rate !== line.book.defaultRate,
    })),
    groupRate: {
      value: groupRates.get(group.book.gameId) ?? group.book.defaultRate,
      label: t("groupRateOf", { code: group.book.gameCode }),
      onChange: (rate) => {
        setGroupRates((current) =>
          new Map(current).set(group.book.gameId, rate),
        );
        setLines((current) => setGameRate(current, group.book.gameId, rate));
      },
    },
  }));

  const valuesOf = () =>
    wholesaleValuesOf({ ...header, accountId }, lines, initial.keptLines);
  const isTooMany = lines.length > WHOLESALE_MAX_LINES;

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Stack spacing={2}>
          <Typography variant="h6" component="h1">
            {title}
          </Typography>
          {notice}
          <WholesaleHeaderFields
            value={{ ...header, accountId }}
            options={data}
            error={error}
            onChange={(patch) => {
              setHeader((current) => ({ ...current, ...patch }));
            }}
            onBranchChange={(next) => {
              setHeader((current) => ({
                ...current,
                fromBranchId: next,
                accountId: null,
              }));
              setLines([]);
              setGroupRates(new Map());
              setScanError(null);
            }}
          />
          <BookGroupList
            mode={mode}
            title={t("lines")}
            groups={groups}
            labels={{
              ...labels,
              empty: fromBranchId === "" ? t("pickBranch") : t("empty"),
            }}
            actions={
              <Button
                variant="outlined"
                disabled={data === null}
                onClick={() => {
                  setIsPicking(true);
                }}
              >
                {t("picker.open")}
              </Button>
            }
            scanBar={
              <BookScanBar
                purpose={WHOLESALE_CREATE_SCAN_PURPOSE}
                label={t("scan")}
                disabled={fromBranchId === "" || data === null}
                onScan={scan}
                gamePicker={{
                  label: tPurchase("fallbackGame"),
                  noneLabel: tPurchase("fallbackGameNone"),
                  options: games,
                  value: fallbackGameId,
                  onChange: setFallbackGameId,
                }}
                message={
                  scanError === null
                    ? null
                    : { severity: "error", text: scanError }
                }
              />
            }
            notice={
              <>
                {initial.keptLines.length > 0 && (
                  <Alert severity="warning">
                    {tEdit("keptLines", { count: initial.keptLines.length })}
                  </Alert>
                )}
                {isTooMany && (
                  <Alert severity="error">
                    {t("tooMany", { count: WHOLESALE_MAX_LINES })}
                  </Alert>
                )}
                <LineErrorAlerts
                  error={error}
                  fieldKey={WHOLESALE_FIELD_KEYS.lines}
                />
                {checks.blockedRows.map((row) => (
                  <Alert key={row} severity="error">
                    {row}
                  </Alert>
                ))}
              </>
            }
            onRate={(rowId, rate) => {
              setLines((current) => setLineRate(current, rowId, rate));
            }}
            onRemove={(rowId) => {
              setLines((current) => removeLine(current, rowId));
            }}
          />
          <WholesaleTotals
            books={lines.length}
            amount={total}
            profit={profitOf(lines, books)}
          />
          {error !== null && <Alert severity="error">{errorText(error)}</Alert>}
        </Stack>
      </Box>
      <FormActions
        {...(isCompact && {
          start: (
            <Typography variant="subtitle2">
              {t("stickyTotal", { amount: formatMoney(total) })}
            </Typography>
          ),
        })}
        cancel={{ label: t("cancel"), onClick: onCancel }}
        {...(canSaveDraft && {
          draft: {
            label: t("saveDraft"),
            disabled: isPending || fromBranchId === "" || data === null,
            onClick: () => {
              onSaveDraft(valuesOf());
            },
          },
        })}
        submit={{
          label: t("submit"),
          // 選項讀到之前不能送:只有一個入帳帳戶時要等選項才帶得進去
          disabled:
            isPending ||
            fromBranchId === "" ||
            data === null ||
            header.customerId === null ||
            (isAutoBank && accountId === null) ||
            lines.length === 0 ||
            isTooMany,
          onClick: () => {
            onSubmit(valuesOf());
          },
        }}
      />
      {isPicking && (
        <WholesaleBookDialog
          books={books}
          addedIds={new Set(lines.map((line) => line.book.bookId))}
          onAdd={(picked) => {
            add(picked);
            setIsPicking(false);
          }}
          onClose={() => {
            setIsPicking(false);
          }}
        />
      )}
    </Stack>
  );
};
