import { type KeyboardEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { TRANSFER_MODE } from "@repo/domain/project/lottery";
import { useLotteryTransferOptionsQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { useBreakpointDown } from "@repo/ui/media-query";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { OrgTreeSelect } from "@/components/base/OrgTreeSelect/OrgTreeSelect";
import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import {
  type AllocationWarningItem,
  AllocationWarnings,
} from "@/components/project/lottery/AllocationWarnings/AllocationWarnings";
import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useFormDraft } from "@/hooks/base/useFormDraft";
import { useMe } from "@/hooks/base/useMe";
import { useModuleForms } from "@/hooks/base/useModuleForms";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useUrlState } from "@/hooks/base/useUrlState";
import { useScanner } from "@/hooks/project/useScanner/useScanner";
import type { FormError } from "@/lib/base/form-engine/form-errors";

import {
  TRANSFER_FIELD_KEYS,
  TRANSFER_FORM_KEY,
  TRANSFER_FROM_REQUISITION,
  TRANSFER_MODULE_KEY,
  TRANSFER_PERMISSIONS,
  formatMoney,
} from "../transfer-keys";
import { TransferBookPanel } from "./TransferBookPanel";
import { TransferLines } from "./TransferLines";
import {
  type AddLineResult,
  type TransferBookOption,
  type TransferDraftLine,
  addPartial,
  addWhole,
  bookOfScan,
  removeLine,
  setLineRate,
  transferTotalOf,
  transferValuesOf,
} from "./transfer-form";

const NONE = "none";

/** 帶入的值(空字串 = 沒帶)。 */
const fromSchema = z.string().default("");

/** 送出時收貨分店讀不到(不在送出的人的可見範圍):改用看得懂的說明。 */
const isToBranchUnavailable = (error: FormError): boolean =>
  (error.fieldErrors ?? []).some(
    (item) =>
      item.fieldKey === TRANSFER_FIELD_KEYS.toBranch &&
      item.code === "SOURCE_UNAVAILABLE",
  );

/** 明細列的 rowId。 */
const newRowId = (): string => crypto.randomUUID();

/** 掃描用途(B10;新增頁刷條碼加入選取)。 */
export const TRANSFER_CREATE_SCAN_PURPOSE = "transfer-create";

/**
 * 調貨單的替換新增頁(專案規格 8.4「頁面」;Figma PU-09 電腦 69:1099、平板 127:27025、手機 127:27418):
 * 單頭(出貨分店、收貨分店、叫貨單、備註)→ 左邊調貨明細(批購金額率可逐本改)+ 調貨金額;右邊選本與
 * 張數格子(整本加入 / 選張加入,刷條碼加入選取)→ [存草稿] [送出]。存值交給表單引擎(`useFormDraft`),
 * 送出前的檢查在 api 的掛接點。從採購清單 [從其他分店調貨] 進來時帶 `?requisition=<單號>&to=<收貨分店>`。
 */
export const TransferCreatePage = () => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.create");
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const showSnackbar = useSnackbar();
  const { session } = useSession();
  const me = useMe();
  const { hasPermission } = usePermissions();
  const canPartial = hasPermission(TRANSFER_PERMISSIONS.partialTickets);
  const isNarrow = useBreakpointDown("lg");
  const access = useFormModuleAccess(TRANSFER_MODULE_KEY);
  const { creatableForms, isLoading: isFormsLoading } =
    useModuleForms(TRANSFER_MODULE_KEY);
  const form = creatableForms.find((item) => item.key === TRANSFER_FORM_KEY);
  const draft = useFormDraft(TRANSFER_FORM_KEY);
  useRouteTabItemLabel(t("tabLabel"));

  const [fromRequisition] = useUrlState(
    TRANSFER_FROM_REQUISITION.requisition,
    fromSchema,
  );
  const [fromTo] = useUrlState(TRANSFER_FROM_REQUISITION.to, fromSchema);
  // 出貨分店:店長預設自己的分店;最上層組織(總部)不預設
  const currentOrg = me.data?.me.currentOrg;
  const isHeadquarters =
    currentOrg?.tenantId == null || currentOrg.tenantId === currentOrg.id;
  const [fromBranch, setFromBranch] = useState<string | null>(null);
  const fromBranchId = fromBranch ?? (isHeadquarters ? "" : currentOrg.id);
  const [toBranchId, setToBranchId] = useState(fromTo);
  const [requisitionNo, setRequisitionNo] = useState<string | null>(
    fromRequisition === "" ? null : fromRequisition,
  );
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<TransferDraftLine[]>([]);
  const [bookId, setBookId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const options = useLotteryTransferOptionsQuery(
    session.client,
    { fromOrgId: fromBranchId, toOrgId: toBranchId === "" ? null : toBranchId },
    { enabled: fromBranchId !== "" },
  );
  const data = options.data?.lotteryTransferOptions ?? null;
  const books = useMemo(() => data?.books ?? [], [data]);
  const book = books.find((item) => item.bookId === bookId) ?? null;
  const inLines =
    lines.find((line) => line.book.bookId === bookId)?.ticketNos ?? [];
  const total = transferTotalOf(lines);
  // 超過收貨店的預計要給本數只警告(規格 7.6):整本一列算一本,零碎張數不湊成一本
  const allocationItems: AllocationWarningItem[] = (
    data?.allocations ?? []
  ).flatMap((allocation) => {
    const whole = lines.filter(
      (line) =>
        line.book.gameId === allocation.gameId &&
        line.mode === TRANSFER_MODE.whole,
    );
    const [first] = whole;
    return first === undefined
      ? []
      : [
          {
            key: allocation.gameId,
            label: `${first.book.gameCode} ${first.book.gameName}`,
            plannedBooks: allocation.plannedBooks ?? null,
            givenBooks: allocation.givenBooks,
            inTransitBooks: allocation.inTransitBooks,
            books: whole.length,
          },
        ];
  });
  const isSameBranch = fromBranchId !== "" && fromBranchId === toBranchId;

  const apply = (result: AddLineResult) => {
    if (result.kind === "added") {
      setLines(result.lines);
      setSelected([]);
      setNotice(null);
      return;
    }
    setNotice(t(`addErrors.${result.kind}`));
  };

  const pickBook = (next: string | null) => {
    setBookId(next);
    setSelected([]);
  };

  /** 刷條碼:整本的本直接整本加入;拆過的本選到那一本並把刷到的那張加進已選。 */
  const scan = (raw: string) => {
    const hit = bookOfScan(books, raw);
    if (hit === null) {
      setNotice(t("scanNotFound"));
      return;
    }
    setCode("");
    if (hit.book.isWhole) {
      apply(addWhole(lines, hit.book, newRowId));
      return;
    }
    if (!canPartial) {
      setNotice(t("partialForbidden"));
      return;
    }
    setNotice(null);
    if (hit.book.bookId !== bookId) {
      setBookId(hit.book.bookId);
      setSelected([hit.ticketNo]);
      return;
    }
    setSelected((current) => [...new Set([...current, hit.ticketNo])]);
  };
  useScanner(TRANSFER_CREATE_SCAN_PURPOSE, ({ code: scanned }) => {
    if (fromBranchId !== "") {
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
    transferValuesOf({ fromBranchId, toBranchId, requisitionNo, note }, lines);
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

  const canSubmit =
    !draft.isPending &&
    fromBranchId !== "" &&
    toBranchId !== "" &&
    !isSameBranch &&
    lines.length > 0;

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
                lg: "repeat(4, 1fr)",
              },
            }}
          >
            <OrgTreeSelect
              scope="visible"
              label={t("fields.fromBranch")}
              value={fromBranchId === "" ? [] : [fromBranchId]}
              required
              fullWidth
              onChange={(ids) => {
                setFromBranch(ids[0] ?? "");
                setLines([]);
                pickBook(null);
              }}
            />
            <OrgTreeSelect
              scope="visible"
              label={t("fields.toBranch")}
              value={toBranchId === "" ? [] : [toBranchId]}
              required
              fullWidth
              error={isSameBranch}
              helperText={isSameBranch ? t("sameBranch") : t("toBranchHint")}
              onChange={(ids) => {
                setToBranchId(ids[0] ?? "");
                setRequisitionNo(null);
              }}
            />
            <SelectField<string>
              label={t("fields.requisition")}
              size="small"
              value={
                data?.requisitions.find(
                  (item) => item.serialNo === requisitionNo,
                )?.id ?? NONE
              }
              disabled={toBranchId === ""}
              options={[
                { value: NONE, label: t("fields.noRequisition") },
                ...(data?.requisitions ?? []).map((item) => ({
                  value: item.id,
                  label: t("fields.requisitionOption", {
                    serialNo: item.serialNo ?? item.id,
                    books: item.books,
                  }),
                })),
              ]}
              onChange={(next) => {
                setRequisitionNo(
                  data?.requisitions.find((item) => item.id === next)
                    ?.serialNo ?? null,
                );
              }}
              fullWidth
            />
            <TextField
              label={t("fields.note")}
              size="small"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              fullWidth
            />
          </Box>
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
            <Card sx={{ p: { xs: 2, sm: 2.5 } }}>
              <Stack spacing={2}>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  sx={{ alignItems: { sm: "center" } }}
                >
                  <Typography
                    variant="subtitle1"
                    component="h2"
                    sx={{ flex: 1 }}
                  >
                    {t("lines")}
                  </Typography>
                  <TextField
                    label={t("scan")}
                    size="small"
                    value={code}
                    disabled={fromBranchId === ""}
                    onChange={(event) => {
                      setCode(event.target.value);
                    }}
                    onKeyDown={handleKey}
                    sx={{ width: { xs: "100%", sm: 240 } }}
                    slotProps={{
                      htmlInput: {
                        "data-scanner-field": TRANSFER_CREATE_SCAN_PURPOSE,
                      },
                    }}
                  />
                </Stack>
                {notice !== null && <Alert severity="warning">{notice}</Alert>}
                <AllocationWarnings items={allocationItems} />
                <TransferLines
                  lines={lines}
                  isCompact={isNarrow}
                  onRate={(rowId, rate) => {
                    setLines((current) => setLineRate(current, rowId, rate));
                  }}
                  onRemove={(rowId) => {
                    setLines((current) => removeLine(current, rowId));
                  }}
                />
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
              </Stack>
            </Card>
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
              onAddWhole={(target: TransferBookOption) => {
                apply(addWhole(lines, target, newRowId));
              }}
              onAddPartial={(target, ticketNos) => {
                apply(addPartial(lines, target, ticketNos, newRowId));
              }}
            />
          </Box>
          {draft.error !== null && (
            <Alert severity="error">
              {isToBranchUnavailable(draft.error)
                ? t("toBranchUnavailable")
                : errorText(draft.error)}
            </Alert>
          )}
        </Stack>
      </Box>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          alignItems: "center",
          borderTop: { xs: 1, lg: 0 },
          borderColor: "divider",
          pt: { xs: 1.5, lg: 0 },
        }}
      >
        <Button variant="text" onClick={backToList}>
          {t("cancel")}
        </Button>
        <Box sx={{ flex: 1 }} />
        {form.allowDraft && (
          <Button
            variant="outlined"
            disabled={draft.isPending || fromBranchId === ""}
            onClick={() => {
              void draft.saveDraft(valuesOf(), []).then((saved) => {
                if (saved !== null) {
                  showSnackbar("success", t("draftSaved"));
                }
              });
            }}
          >
            {t("saveDraft")}
          </Button>
        )}
        <Button
          disabled={!canSubmit}
          onClick={() => {
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
          }}
        >
          {t("submit")}
        </Button>
      </Stack>
    </Stack>
  );
};
