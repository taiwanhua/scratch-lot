import { type ReactNode, useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import type { StoredValues } from "@repo/domain/form";
import { TRANSFER_MODE } from "@repo/domain/project/lottery";
import { useLotteryTransferOptionsQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { FormActions } from "@/components/base/FormActions/FormActions";
import { AllocationWarnings } from "@/components/project/lottery/AllocationWarnings/AllocationWarnings";
import {
  BookGroupList,
  type BookRowStatus,
} from "@/components/project/lottery/BookGroupList/BookGroupList";
import { BookScanBar } from "@/components/project/lottery/BookScanBar/BookScanBar";
import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import type { FormError } from "@/lib/base/form-engine/form-errors";

import { LineErrorAlerts } from "../../shared/LineErrorAlerts";
import {
  TRANSFER_FIELD_KEYS,
  TRANSFER_PERMISSIONS,
  formatMoney,
} from "../transfer-keys";
import { DropConfirmDialog } from "./DropConfirmDialog";
import { TransferBookPanel } from "./TransferBookPanel";
import { TransferHeaderFields } from "./TransferHeaderFields";
import {
  type AddLineResult,
  type TransferBookOption,
  type TransferDraftLine,
  type TransferFormState,
  addPartial,
  addWhole,
  bookOfScan,
  removeLine,
  setLineRate,
  transferAllocationItemsOf,
  transferTotalOf,
  transferValuesOf,
} from "./transfer-form";
import { type ShippedRowFacts, useShippedLines } from "./useShippedLines";
import { useTransferLineList } from "./useTransferLineList";
import { useTransferTicketChecks } from "./useTransferTicketChecks";

/** 送出時收貨分店讀不到(不在送出的人的可見範圍):改用看得懂的說明。 */
const isToBranchUnavailable = (error: FormError): boolean =>
  (error.fieldErrors ?? []).some(
    (item) =>
      item.fieldKey === TRANSFER_FIELD_KEYS.toBranch &&
      item.code === "SOURCE_UNAVAILABLE",
  );

/** 明細列的 rowId。 */
const newRowId = (): string => crypto.randomUUID();

/** 掃描用途(B10;新增 / 編輯頁刷條碼或手輸張號加入)。 */
export const TRANSFER_CREATE_SCAN_PURPOSE = "transfer-create";

export interface TransferFormProps {
  /** `create` 新增頁;`edit` 編輯頁(草稿 / 被退回) */
  mode: "create" | "edit";
  /** 編輯中的那一筆(叫貨單選項另含它已引用的);新增 = null */
  submissionId: string | null;
  title: string;
  initial: TransferFormState;
  /** 鎖住的列與狀態(編輯頁:已點收 / 部分點收 / 已出貨在途);不在裡面 = 可改可刪 */
  lockedRows: ReadonlyMap<string, BookRowStatus>;
  /** 已出貨、還沒到齊的列(編輯頁;選張的列可以取消勾選沒到的張);新增頁不給 */
  shippedRows?: ReadonlyMap<string, ShippedRowFacts>;
  notice?: ReactNode;
  canSaveDraft: boolean;
  isPending: boolean;
  error: FormError | null;
  onSaveDraft: (values: StoredValues) => void;
  onSubmit: (values: StoredValues) => void;
  onCancel: () => void;
}

/**
 * 調貨單的新增 / 編輯畫面(專案規格 8.4「頁面」;Figma PU-09 電腦 69:1099、平板 127:27025、手機 127:27418):
 * 單頭(出貨分店、收貨分店、叫貨單、備註)→ 左邊調貨明細(`BookGroupList`:依遊戲分組,批購金額率可逐本改)+
 * 調貨金額,刷條碼列(`BookScanBar`,一直顯示「正面條碼的遊戲」)加入選取;右邊選本與張數格子
 * (`TransferBookPanel`,整本加入 / 選張加入;形狀和本清單不同,保留)→ [存草稿] [送出]。
 * 編輯頁帶入原內容:已出貨(在途)/ 已點收的列鎖住並標示,出貨 / 收貨分店也鎖住;其他列同新增頁。
 */
export const TransferForm = ({
  mode,
  submissionId,
  title,
  initial,
  lockedRows,
  shippedRows = new Map(),
  notice,
  canSaveDraft,
  isPending,
  error,
  onSaveDraft,
  onSubmit,
  onCancel,
}: TransferFormProps) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.create");
  const tEdit = useTranslations("admin.lotteryPurchasing.transfer.edit");
  const tPurchase = useTranslations("admin.lotteryPurchasing.purchase.create");
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const { session } = useSession();
  const { hasPermission } = usePermissions();
  const canPartial = hasPermission(TRANSFER_PERMISSIONS.partialTickets);
  const [fromBranchId, setFromBranchId] = useState(initial.header.fromBranchId);
  const [toBranchId, setToBranchId] = useState(initial.header.toBranchId);
  const [requisitionNo, setRequisitionNo] = useState<string | null>(
    initial.header.requisitionNo,
  );
  const [note, setNote] = useState(initial.header.note);
  const [lines, setLines] = useState<TransferDraftLine[]>(initial.lines);
  const [bookId, setBookId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [fallbackGameId, setFallbackGameId] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<{
    severity: "warning" | "error";
    text: string;
  } | null>(null);
  const locked = useMemo(() => new Set(lockedRows.keys()), [lockedRows]);
  const hasLocked = lines.some((line) => locked.has(line.rowId));

  const options = useLotteryTransferOptionsQuery(
    session.client,
    {
      fromOrgId: fromBranchId,
      toOrgId: toBranchId === "" ? null : toBranchId,
      submissionId,
    },
    { enabled: fromBranchId !== "" },
  );
  const data = options.data?.lotteryTransferOptions ?? null;
  // 出貨店能不能點格子選張(張數店與轉換中一律不能;編號店看「調貨單可點格子選張」;張數店規格 7.4)
  const gridPick = data?.gridPick ?? true;
  const isCountStore =
    data?.countMode === "count" || data?.countMode === "converting";
  const checks = useTransferTicketChecks(fromBranchId, lines, error);
  const books = useMemo(() => data?.books ?? [], [data]);
  const book = books.find((item) => item.bookId === bookId) ?? null;
  const inLines =
    lines.find((line) => line.book.bookId === bookId)?.ticketNos ?? [];
  const total = transferTotalOf(lines);
  // 超過收貨店的預計要給本數只警告(規格 7.6)
  const allocationItems = transferAllocationItemsOf(
    data?.allocations ?? [],
    lines,
  );
  const isSameBranch = fromBranchId !== "" && fromBranchId === toBranchId;
  const games = [
    ...new Map(
      books.map((item) => [
        item.gameId,
        { value: item.gameId, label: `${item.gameCode} ${item.gameName}` },
      ]),
    ).values(),
  ];

  const apply = (result: AddLineResult) => {
    if (result.kind === "added") {
      setLines(result.lines);
      setSelected([]);
      setScanNotice(null);
      return;
    }
    setScanNotice({ severity: "warning", text: t(`addErrors.${result.kind}`) });
  };

  const pickBook = (next: string | null) => {
    setBookId(next);
    setSelected([]);
  };

  /**
   * 刷條碼或手輸張號:整本的本直接整本加入;拆過的本先重新拿格子資料判斷這張能不能調(張數店規格 7.4:
   * 不能調的當下寫原因與處理方式、不加進已選),能調才選到那一本並把這張加進已選。
   */
  const scan = async (raw: string): Promise<boolean> => {
    if (fromBranchId === "") {
      return false;
    }
    const hit = bookOfScan(books, raw, fallbackGameId);
    if (hit.kind === "ambiguous_game") {
      setScanNotice({ severity: "warning", text: t("scanAmbiguousGame") });
      return false;
    }
    if (hit.kind === "not_found") {
      setScanNotice({ severity: "warning", text: t("scanNotFound") });
      return false;
    }
    if (hit.book.isWhole) {
      apply(addWhole(lines, hit.book, newRowId));
      return true;
    }
    if (!canPartial) {
      setScanNotice({ severity: "warning", text: t("partialForbidden") });
      return true;
    }
    const problem = await checks.checkTicket(hit.book.bookId, hit.ticketNo);
    if (problem !== null) {
      setScanNotice({ severity: "error", text: problem });
      return false;
    }
    setScanNotice(null);
    if (hit.book.bookId !== bookId) {
      setBookId(hit.book.bookId);
      setSelected([hit.ticketNo]);
      return true;
    }
    setSelected((current) => [...new Set([...current, hit.ticketNo])]);
    return true;
  };

  const shipped = useShippedLines(lines, setLines, shippedRows);
  const [isConfirmingDrop, setIsConfirmingDrop] = useState(false);
  const { groups, labels } = useTransferLineList(
    lines,
    lockedRows,
    shipped.rowExtrasOf,
  );

  const valuesOf = () =>
    transferValuesOf(
      { fromBranchId, toBranchId, requisitionNo, note },
      lines,
      initial.keptLines,
    );
  const canSubmit =
    !isPending &&
    fromBranchId !== "" &&
    toBranchId !== "" &&
    !isSameBranch &&
    lines.length > 0;

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <Stack spacing={2}>
          <Typography variant="h6" component="h1">
            {title}
          </Typography>
          {notice}
          {gridPick || fromBranchId === "" ? null : (
            <Alert severity="info">
              {isCountStore ? t("gridPickCount") : t("gridPickOff")}
            </Alert>
          )}
          <TransferHeaderFields
            fromBranchId={fromBranchId}
            toBranchId={toBranchId}
            requisitionNo={requisitionNo}
            note={note}
            requisitions={data?.requisitions ?? []}
            isBranchLocked={hasLocked}
            onFromBranch={(next) => {
              setFromBranchId(next);
              setLines([]);
              pickBook(null);
            }}
            onToBranch={(next) => {
              setToBranchId(next);
              setRequisitionNo(null);
            }}
            onRequisition={setRequisitionNo}
            onNote={setNote}
            error={error}
          />
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: {
                xs: "1fr",
                lg: "minmax(0, 1fr) 420px",
              },
              alignItems: "start",
            }}
          >
            <BookGroupList
              mode={mode}
              title={t("lines")}
              groups={groups}
              labels={labels}
              scanBar={
                <BookScanBar
                  purpose={TRANSFER_CREATE_SCAN_PURPOSE}
                  label={t("scan")}
                  disabled={fromBranchId === ""}
                  onScan={scan}
                  gamePicker={{
                    label: tPurchase("fallbackGame"),
                    noneLabel: tPurchase("fallbackGameNone"),
                    options: games,
                    value: fallbackGameId,
                    onChange: setFallbackGameId,
                  }}
                  message={scanNotice}
                />
              }
              notice={
                <>
                  {hasLocked && (
                    <Alert severity="info">{tEdit("lockedHint")}</Alert>
                  )}
                  {initial.keptLines.length > 0 && (
                    <Alert severity="warning">
                      {tEdit("keptLines", { count: initial.keptLines.length })}
                    </Alert>
                  )}
                  <AllocationWarnings items={allocationItems} />
                  <LineErrorAlerts
                    error={error}
                    fieldKey={TRANSFER_FIELD_KEYS.lines}
                  />
                  {checks.blockedRows.map((row) => (
                    <Alert key={row} severity="error">
                      {row}
                    </Alert>
                  ))}
                </>
              }
              footer={
                <Stack
                  direction="row"
                  sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}
                >
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {t("transferTotal")}
                  </Typography>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {formatMoney(total)}
                  </Typography>
                </Stack>
              }
              onRate={(rowId, rate) => {
                if (!locked.has(rowId)) {
                  setLines((current) => setLineRate(current, rowId, rate));
                }
              }}
              onRemove={(rowId) => {
                // 已點收(含部分點收)的列不能刪;在途的列可以(路上遺失 → 待查)
                const status = lockedRows.get(rowId);
                if (status !== "received" && status !== "partial") {
                  setLines((current) => removeLine(current, rowId));
                }
              }}
            />
            <TransferBookPanel
              fromOrgId={fromBranchId}
              books={books}
              book={book}
              onBookChange={pickBook}
              selected={selected}
              onSelectedChange={setSelected}
              inLines={
                lines.some(
                  (line) =>
                    line.book.bookId === bookId &&
                    line.mode === TRANSFER_MODE.partial,
                )
                  ? inLines
                  : []
              }
              canPartial={canPartial}
              gridPick={gridPick}
              onAddWhole={(target: TransferBookOption) => {
                apply(addWhole(lines, target, newRowId));
              }}
              onAddPartial={(target, ticketNos) => {
                apply(addPartial(lines, target, ticketNos, newRowId, locked));
              }}
            />
          </Box>
          {error !== null && (
            <Alert severity="error">
              {isToBranchUnavailable(error)
                ? t("toBranchUnavailable")
                : errorText(error)}
            </Alert>
          )}
        </Stack>
      </Box>
      <FormActions
        cancel={{ label: t("cancel"), onClick: onCancel }}
        {...(canSaveDraft && {
          draft: {
            label: t("saveDraft"),
            disabled: isPending || fromBranchId === "",
            onClick: () => {
              onSaveDraft(valuesOf());
            },
          },
        })}
        submit={{
          label: t("submit"),
          disabled: !canSubmit,
          onClick: () => {
            // 有在途的張會變成待查(取消勾選 / 整列移除)→ 先確認
            if (shipped.confirmText === null) {
              onSubmit(valuesOf());
              return;
            }
            setIsConfirmingDrop(true);
          },
        }}
      />
      {isConfirmingDrop && shipped.confirmText !== null && (
        <DropConfirmDialog
          text={shipped.confirmText}
          isPending={isPending}
          onCancel={() => {
            setIsConfirmingDrop(false);
          }}
          onConfirm={() => {
            setIsConfirmingDrop(false);
            onSubmit(valuesOf());
          }}
        />
      )}
    </Stack>
  );
};
