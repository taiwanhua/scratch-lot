import { keepPreviousData } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  STOCKTAKE_SCAN_PURPOSE,
  STORE_BOARD_KEY,
  type StocktakeDiffAction,
  normalizeBookNo,
  parseStocktakeDraft,
  parseTicketInput,
  serializeStocktakeDraft,
} from "@repo/domain/project/lottery";
import {
  useBackfillLotteryStocktakeSalesMutation,
  useLotteryStocktakeReviewQuery,
  useLotteryStocktakeSheetQuery,
} from "@repo/graphql";

import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { useRealtimeBoard } from "@/hooks/base/useRealtime";
import { useScanner } from "@/hooks/base/useScanner/useScanner";
import { useSession } from "@/hooks/base/useSession";
import { parseAdminError } from "@/lib/base/errors";

import { moneyText } from "../store-text";
import {
  type StocktakeFlowInput,
  isItemCounted,
  resumedOf,
  sheetInputOf,
  stocktakeItemsOf,
  useResetOnChange,
} from "./stocktake-count-model";
import {
  type BookCount,
  type LostChoice,
  type ReviewLine,
  type StocktakeSheet,
  type StocktakeState,
  bookKeyOf,
  diffKeyOf,
  draftOf,
  emptyState,
  lineKeyOf,
  lostGroupsOf,
  omitKeys,
  stateOfDraft,
} from "./stocktake-model";
import { useCountGroupActions } from "./useCountGroupActions";

type ReviewDiff = ReviewLine["diffs"][number];

/**
 * [繼續] 帶回的進度:先記下來,讀到盤點資料(與初始狀態)後在畫面計算時套用一次(同 React 的「依前一次 render 調整 state」)。
 */
const useResumedDraft = (
  sheet: StocktakeSheet | null,
  state: StocktakeState | null,
  apply: (resumed: NonNullable<ReturnType<typeof resumedOf>>) => void,
) => {
  const [pending, setPending] = useState<string | null>();
  if (sheet !== null && state !== null && pending !== undefined) {
    const parsed = parseStocktakeDraft(pending ?? "");
    const resumed = resumedOf(parsed.ok ? parsed.draft : null, sheet);
    if (resumed !== null) {
      apply(resumed);
    }
    setPending(undefined);
  }
  return { restore: setPending, isRestoring: pending !== undefined };
};

/**
 * 盤點頁的畫面狀態與動作(規格 6.0、6.8;`StocktakeWorkspace` 用):盤點資料、每本開始盤的時間
 * (伺服器時間)、點到的張、未拆的本、待查清單、差異的處理、[補登售出](立即生效)、刷條碼。
 * 張數店(與轉換中)的檯面是「收銀點 × 遊戲」的組(張數店規格 8.1):輸入實際剩幾張、[確定] 後才顯示系統數字、[重數];
 * 少 → [算售出 N 張](立即生效)/ [待查];多 → [標記異常]。進度由盤點中登記存到伺服器(`useStocktakeSession`),
 * 重新整理後 [繼續] 以 `restore` 帶回已數的組與 `countedAt`。
 */
export const useStocktakeFlow = ({
  orgId,
  scopeCashPointId,
  initialDraft,
  purpose = "normal",
}: StocktakeFlowInput) => {
  const t = useTranslations("admin.lotteryStore.stocktake");
  const { session } = useSession();
  const showSnackbar = useSnackbar();
  useRealtimeBoard(STORE_BOARD_KEY, orgId === "" ? null : orgId);
  const sheetQuery = useLotteryStocktakeSheetQuery(
    session.client,
    { input: sheetInputOf(orgId, scopeCashPointId, purpose) },
    { enabled: orgId !== "", retry: false },
  );
  const sheet = sheetQuery.data?.lotteryStocktakeSheet ?? null;
  // 伺服器與這台裝置的時間差:每本開始盤的時間以伺服器時間記(不受裝置時鐘影響)
  const offset =
    sheet === null ? 0 : Date.parse(sheet.serverNow) - sheetQuery.dataUpdatedAt;
  const nowIso = () => new Date(Date.now() + offset).toISOString();

  const [state, setState] = useState<StocktakeState | null>(null);
  const [viewedAt, setViewedAt] = useState<Partial<Record<string, string>>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [step, setStep] = useState<"count" | "review">("count");
  const [notice, setNotice] = useState<string | null>(null);
  // 日結第 ② 步換「現在盤點 / 這次做補點編號」:換了就從頭盤(兩種的盤點資料不同)
  useResetOnChange(purpose, () => {
    setState(null);
    setViewedAt({});
    setSelectedKey(null);
    setStep("count");
  });
  const isRenumber = sheet?.purpose === "renumber";

  // 讀到盤點資料後才定開始時間(伺服器讀到資料的時間;退回 → 帶入原內容)
  if (sheet !== null && state === null) {
    setState(
      initialDraft === null
        ? emptyState(sheet.serverNow)
        : stateOfDraft(initialDraft, sheet),
    );
  }
  const isCountMode = sheet?.countMode === "count";
  const { books, countGroups, itemKeys, currentKey, current, currentGroup } =
    stocktakeItemsOf(sheet, selectedKey);
  /** 這一項已數(本:有盤點;組:按了 [確定])。 */
  const isCounted = (key: string): boolean => isItemCounted(state, key);
  // 開始盤這一本的時間 = 畫面上的格子那一刻的系統數字(盤點資料讀到的伺服器時間)
  if (
    sheet !== null &&
    currentKey !== null &&
    viewedAt[currentKey] === undefined
  ) {
    setViewedAt((before) => ({ ...before, [currentKey]: sheet.serverNow }));
  }

  const draft =
    sheet === null || state === null
      ? null
      : draftOf(orgId, scopeCashPointId, state, sheet);
  const reviewQuery = useLotteryStocktakeReviewQuery(
    session.client,
    { input: { draft: draft === null ? "" : serializeStocktakeDraft(draft) } },
    {
      enabled: step === "review" && draft !== null,
      retry: false,
      // 選處理會改盤點內容(查詢的 key):重抓時留著上一份,列表不閃
      placeholderData: keepPreviousData,
    },
  );
  const review = reviewQuery.data?.lotteryStocktakeReview ?? null;
  const backfill = useBackfillLotteryStocktakeSalesMutation(session.client);

  const update = (change: (before: StocktakeState) => StocktakeState) => {
    setState((before) => (before === null ? before : change(before)));
  };
  const setCount = (
    key: string,
    next: Pick<BookCount, "method" | "present">,
  ) => {
    update((before) => ({
      ...before,
      counts: {
        ...before.counts,
        [key]: {
          countedAt: before.counts[key]?.countedAt ?? viewedAt[key] ?? nowIso(),
          ...next,
        },
      },
    }));
  };
  const lostGroups = sheet === null ? [] : lostGroupsOf(sheet);

  // ---- 張數盤點的組([確定] / [重數] / [算售出] / [待查] / [標記異常]) ----
  const countActions = useCountGroupActions({
    orgId,
    update,
    nowIso,
    viewedAt,
    setViewedAt,
    setSelectedKey,
    setStep,
    setNotice,
    refetch: () => {
      void sheetQuery.refetch();
      void reviewQuery.refetch();
    },
  });

  // [繼續]:帶回存在盤點中登記上的進度(讀到盤點資料後才套用;套用前 `isRestoring`)
  const resume = useResumedDraft(sheet, state, (resumed) => {
    setState(resumed.state);
    setViewedAt(resumed.viewedAt);
  });

  /** 刷到 / 輸入的碼:這次盤點範圍裡的那一張記為「在」;待查清單裡的本記為「找到了」(已刷到)。 */
  const handleCode = (code: string) => {
    const parsed = parseTicketInput(code);
    const bookNo = parsed === null ? null : normalizeBookNo(parsed.bookNo);
    if (parsed === null || bookNo === null) {
      showSnackbar("warning", t("book.scanNotHere"));
      return;
    }
    const sameGame = (gameCode: string) =>
      parsed.gameCode === undefined || parsed.gameCode === gameCode;
    const book = books.find(
      (item) =>
        item.bookNo === bookNo &&
        sameGame(item.gameCode) &&
        item.tickets.some((ticket) => ticket.ticketNo === parsed.ticketNo),
    );
    if (book !== undefined) {
      const key = bookKeyOf(book);
      const before = state?.counts[key];
      setSelectedKey(key);
      setCount(key, {
        method: before?.method ?? "scan",
        present: [...new Set([...(before?.present ?? []), parsed.ticketNo])],
      });
      showSnackbar("success", t("book.scanned", { ticketNo: parsed.ticketNo }));
      return;
    }
    // 待查清單:整本都待查 → 刷到這本任一張就算整本找到;零碎 → 刷到的那一張才算
    const group = lostGroups.find(
      (item) =>
        !item.unmatched &&
        item.bookNo === bookNo &&
        sameGame(item.gameCode) &&
        (item.wholeBook ||
          item.tickets.some((ticket) => ticket.ticketNo === parsed.ticketNo)),
    );
    if (group === undefined) {
      showSnackbar("warning", t("book.scanNotHere"));
      return;
    }
    const ticketIds = group.wholeBook
      ? group.tickets.map((ticket) => ticket.ticketId)
      : group.tickets
          .filter((ticket) => ticket.ticketNo === parsed.ticketNo)
          .map((ticket) => ticket.ticketId);
    update((before) => {
      const previous = before.lost[group.bookId];
      const scanned =
        previous?.action === "found" ? previous.scannedTicketIds : [];
      return {
        ...before,
        lost: {
          ...before.lost,
          [group.bookId]: {
            action: "found",
            reasonKey: "",
            reasonNote: "",
            scannedTicketIds: [...new Set([...scanned, ...ticketIds])],
          },
        },
      };
    });
    showSnackbar(
      "success",
      group.wholeBook
        ? t("lost.foundOk")
        : t("lost.foundTicket", { ticketNo: parsed.ticketNo }),
    );
  };
  // 宣告盤點的掃描用途:盤點中刷到的碼記為「在」,不會被當成售出
  useScanner(STOCKTAKE_SCAN_PURPOSE, ({ code }) => {
    handleCode(code);
  });

  const setUnopened = (bookId: string, present: boolean) => {
    update((before) => ({
      ...before,
      unopened: { ...before.unopened, [bookId]: present },
    }));
  };
  const setLost = (bookId: string, choice: LostChoice | null) => {
    update((before) => ({
      ...before,
      lost:
        choice === null
          ? omitKeys(before.lost, (key) => key === bookId)
          : { ...before.lost, [bookId]: choice },
    }));
  };

  // ---- 差異核對 ----
  const staleNos =
    review?.lines.flatMap((line) =>
      line.staleTicketNos.map((no) => ({ line, no })),
    ) ?? [];
  const clearStale = () => {
    const keys = new Set(
      staleNos.map(({ line, no }) =>
        diffKeyOf(lineKeyOf(line.bookId, line.cashPointId), no),
      ),
    );
    update((before) => ({
      ...before,
      diffs: omitKeys(before.diffs, (key) => keys.has(key)),
    }));
    setNotice(null);
  };
  const choose = (keys: readonly string[], action: StocktakeDiffAction) => {
    update((before) => ({
      ...before,
      diffs: {
        ...before.diffs,
        ...Object.fromEntries(
          keys.map((key) => [key, { action, eventId: null }]),
        ),
      },
    }));
  };
  const backfilledChoices = (
    rows: readonly { line: ReviewLine; diff: ReviewDiff }[],
    items: readonly { ticketId: string; eventId: string }[],
  ) =>
    Object.fromEntries(
      rows.flatMap((row) => {
        const item = items.find(
          (candidate) => candidate.ticketId === row.diff.ticketId,
        );
        const key = diffKeyOf(
          lineKeyOf(row.line.bookId, row.line.cashPointId),
          row.diff.ticketNo,
        );
        return item === undefined
          ? []
          : [
              [
                key,
                { action: "sale_backfill" as const, eventId: item.eventId },
              ],
            ];
      }),
    );
  /** [補登售出](立即生效):已被處理 → 提示重新核對。 */
  const runBackfill = (
    rows: readonly { line: ReviewLine; diff: ReviewDiff }[],
  ) => {
    setNotice(null);
    const input = {
      orgId,
      tickets: rows.map((row) => ({
        ticketId: row.diff.ticketId,
        version: row.diff.version,
      })),
    };
    void backfill
      .mutateAsync({ input })
      .then((data) => {
        const items = data.backfillLotteryStocktakeSales.items;
        update((before) => ({
          ...before,
          diffs: { ...before.diffs, ...backfilledChoices(rows, items) },
        }));
        showSnackbar(
          "success",
          t("review.backfillDone", {
            count: items.length,
            amount: moneyText(
              items.reduce((sum, item) => sum + item.amount, 0),
            ),
          }),
        );
        void sheetQuery.refetch();
      })
      .catch((error: unknown) => {
        const failure = parseAdminError(error, {
          codes: ["CONFLICT", "VALIDATION_FAILED"],
          reasons: ["STOCKTAKE_ALREADY_PROCESSED", "STOCKTAKE_NO_SHIFT"],
        });
        setNotice(
          failure.reason === "STOCKTAKE_NO_SHIFT"
            ? t("review.noShift")
            : t("review.alreadyProcessed"),
        );
        void sheetQuery.refetch();
        void reviewQuery.refetch();
      });
  };
  /** 整本重新盤點:清掉那本的盤點與處理(已補登的售出不退)。 */
  const recount = (line: ReviewLine) => {
    const key = lineKeyOf(line.bookId, line.cashPointId);
    update((before) => ({
      ...before,
      counts: omitKeys(before.counts, (item) => item === key),
      diffs: omitKeys(
        before.diffs,
        (item, choice) =>
          item.startsWith(`${key}#`) && choice?.action !== "sale_backfill",
      ),
    }));
    setViewedAt((before) => ({ ...before, [key]: nowIso() }));
    setSelectedKey(key);
    setStep("count");
  };

  return {
    sheetQuery,
    sheet,
    state,
    isRenumber,
    books,
    countGroups,
    isCountMode,
    itemKeys,
    isCounted,
    current,
    currentGroup,
    currentKey,
    viewedAt,
    select: setSelectedKey,
    setCount,
    setUnopened,
    setLost,
    lostGroups,
    handleCode,
    step,
    setStep,
    draft,
    serializedDraft: draft === null ? null : serializeStocktakeDraft(draft),
    restore: resume.restore,
    isRestoring: resume.isRestoring,
    review,
    reviewQuery,
    ...countActions,
    isBackfilling: backfill.isPending || countActions.isBackfilling,
    runBackfill,
    choose,
    recount,
    staleNos,
    clearStale,
    notice,
  };
};
