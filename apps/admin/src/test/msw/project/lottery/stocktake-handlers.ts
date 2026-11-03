import { type GraphQLResponseBody, HttpResponse } from "msw";

import {
  type StocktakeDraft,
  parseStocktakeDraft,
} from "@repo/domain/project/lottery";
import type {
  BackfillLotteryStocktakeCountSalesMutationVariables,
  BackfillLotteryStocktakeSalesMutationVariables,
  EndLotteryStocktakeSessionMutationVariables,
  LotteryStocktakeQueryVariables,
  LotteryStocktakeReviewQuery,
  LotteryStocktakeReviewQueryVariables,
  LotteryStocktakeSheetQueryVariables,
  LotteryStocktakesQueryVariables,
  SaveLotteryStocktakeSessionMutationVariables,
  StartLotteryStocktakeSessionMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api, type server } from "../../server";
import {
  type RescanReminderFixture,
  type RescanWorld,
  type RescanWorldOptions,
  rescanBriefOf,
  rescanWorld,
} from "./rescan-handlers";
import {
  sampleCountStocktakeDetail,
  sampleCountStocktakeSheet,
} from "./stocktake-count-fixtures";
import {
  type StocktakeSessionFixture,
  countReviewOf,
  countStocktakeHandlers,
} from "./stocktake-count-handlers";
import {
  STOCKTAKE_REVIEWING_ID,
  type StocktakeSheetFixture,
  sampleStocktakeDetail,
  sampleStocktakeList,
  sampleStocktakeSheet,
} from "./stocktake-fixtures";

export {
  type StocktakeSessionFixture,
  sampleStocktakeSession,
} from "./stocktake-count-handlers";

type Review = LotteryStocktakeReviewQuery["lotteryStocktakeReview"];
type ReviewLine = Review["lines"][number];

export interface StocktakeWorldOptions {
  /** 距離上次盤點超過 24 小時(看板頂部的提醒);預設 true */
  remind?: boolean;
  /** 補登售出時這幾張已被處理(回 `STOCKTAKE_ALREADY_PROCESSED`) */
  processedTicketIds?: readonly string[];
  /** 張數店(檯面是「收銀點 × 遊戲」的組;張數店規格 8.1) */
  countMode?: boolean;
  /** 這家店現有的盤點中登記(別人的會擋住重疊的位置;張數店規格 8.5a) */
  sessions?: readonly StocktakeSessionFixture[];
  /** 這幾組(`<收銀點>:<遊戲>`)在開始數之後被別張盤點處理過(B6:要重數) */
  staleGroups?: readonly string[];
  /** 全店重刷(重刷頁、看板橫幅;進行中的會列在 `lotteryStocktakeStatus.rescans`) */
  rescan?: RescanWorldOptions;
  /** 全店重刷提醒(張數店規格 8.3) */
  rescanReminders?: readonly RescanReminderFixture[];
}

export interface StocktakeWorld {
  handlers: Parameters<typeof server.use>;
  rescan: RescanWorld;
  state: {
    sheet: StocktakeSheetFixture;
    backfilled: Set<string>;
    sessions: StocktakeSessionFixture[];
  };
  inputs: {
    backfill: BackfillLotteryStocktakeSalesMutationVariables["input"][];
    countBackfill: BackfillLotteryStocktakeCountSalesMutationVariables["input"][];
    reviews: StocktakeDraft[];
    sessionStarts: StartLotteryStocktakeSessionMutationVariables["input"][];
    sessionSaves: SaveLotteryStocktakeSessionMutationVariables["input"][];
    sessionEnds: EndLotteryStocktakeSessionMutationVariables["input"][];
  };
}

/** 業務錯誤(GQL-04;`graphqlError` 只收登入的錯誤碼)。 */
const apiError = (code: string, extensions: Record<string, unknown>) =>
  HttpResponse.json<GraphQLResponseBody<Record<string, never>>>({
    data: null,
    errors: [{ message: code, extensions: { ...extensions, code } }],
  });

/** 畫面上的處理對不到目前差異的張號(已被處理)。 */
const staleNosOf = (
  choices: StocktakeDraft["lines"][number]["diffs"],
  diffs: readonly { ticket: { ticketNo: string }; backfilled: boolean }[],
): string[] =>
  choices
    .filter((choice) => {
      const diff = diffs.find(
        (item) => item.ticket.ticketNo === choice.ticketNo,
      );
      return (choice.action === "sale_backfill") !== diff?.backfilled;
    })
    .map((choice) => choice.ticketNo);

const bookOfTicket = (sheet: StocktakeSheetFixture, ticketId: string) =>
  sheet.books.find((item) =>
    item.tickets.some((ticket) => ticket.ticketId === ticketId),
  );

/**
 * 盤點的假 api(夾具在 `stocktake-fixtures.ts`;規則照 `docs/modules/project/store.md`「盤點」):有狀態 ——
 * 補登售出後那張改已售、那個收銀點的應有現金增加;差異核對照盤點內容比(未售不在 / 已售還在;
 * 已補登的照列、對不到的處理列為「已被處理」)。元件測試與 mock 模式共用。
 */
export const stocktakeWorld = (
  options: StocktakeWorldOptions = {},
): StocktakeWorld => {
  const sheet =
    options.countMode === true
      ? sampleCountStocktakeSheet()
      : sampleStocktakeSheet();
  const backfilled = new Set<string>();
  const sessions: StocktakeSessionFixture[] = [...(options.sessions ?? [])];
  const rescan = rescanWorld(options.rescan);
  /** 開始數那一刻的系統數字(算售出後畫面上的未售會變,比對仍用這個) */
  const systemOf = new Map(
    sheet.countGroups.map((group) => [
      `${group.cashPointId}:${group.gameId}`,
      group.unsoldCount,
    ]),
  );
  /** 算售出寫的張數(依 refId) */
  const countSales = new Map<string, number>();
  const inputs: StocktakeWorld["inputs"] = {
    backfill: [],
    countBackfill: [],
    reviews: [],
    sessionStarts: [],
    sessionSaves: [],
    sessionEnds: [],
  };

  const reviewOf = (draft: StocktakeDraft): Review => {
    let stale = 0;
    let unhandled = 0;
    let backfillCount = 0;
    let backfillAmount = 0;
    let investigate = 0;
    let flagged = 0;
    const lines: ReviewLine[] = draft.lines.flatMap((line) => {
      const book = sheet.books.find(
        (item) =>
          item.bookId === line.bookId && item.cashPointId === line.cashPointId,
      );
      if (book === undefined) {
        return [];
      }
      const present = new Set(line.presentTicketNos);
      const diffs = book.tickets.flatMap((ticket) => {
        const isBackfilled = backfilled.has(ticket.ticketId);
        const wasUnsold = ticket.status === "unsold" || isBackfilled;
        if (wasUnsold && !present.has(ticket.ticketNo)) {
          return [{ ticket, kind: "missing", backfilled: isBackfilled }];
        }
        if (!wasUnsold && present.has(ticket.ticketNo)) {
          return [{ ticket, kind: "extra", backfilled: false }];
        }
        return [];
      });
      const staleNos = staleNosOf(line.diffs, diffs);
      stale += staleNos.length;
      for (const diff of diffs) {
        const choice = line.diffs.find(
          (item) => item.ticketNo === diff.ticket.ticketNo,
        );
        if (choice === undefined) {
          unhandled += 1;
        } else if (choice.action === "sale_backfill") {
          backfillCount += 1;
          backfillAmount += book.unitPrice;
        } else if (choice.action === "investigate") {
          investigate += 1;
        } else {
          flagged += 1;
        }
      }
      return [
        {
          __typename: "LotteryStocktakeReviewLine" as const,
          bookId: book.bookId,
          cashPointId: book.cashPointId,
          cashPointName:
            sheet.cashPoints.find((point) => point.id === book.cashPointId)
              ?.name ?? "",
          gameCode: book.gameCode,
          gameName: book.gameName,
          bookNo: book.bookNo,
          unitPrice: book.unitPrice,
          systemCount: book.tickets.filter(
            (ticket) =>
              ticket.status === "unsold" || backfilled.has(ticket.ticketId),
          ).length,
          presentCount: present.size,
          diffs: diffs.map((diff) => ({
            __typename: "LotteryStocktakeDiff" as const,
            ticketId: diff.ticket.ticketId,
            ticketNo: diff.ticket.ticketNo,
            version: diff.ticket.version,
            kind: diff.kind,
            backfilled: diff.backfilled,
          })),
          pendingReversalTicketNos: [],
          staleTicketNos: staleNos,
        },
      ];
    });
    const unopenedAbsent = draft.unopened
      .filter((item) => !item.present)
      .reduce(
        (sum, item) =>
          sum +
          (sheet.unopenedBooks.find((book) => book.bookId === item.bookId)
            ?.ticketCount ?? 0),
        0,
      );
    const lost = draft.lostReview.filter((item) => item.action === "lost");
    // 張數盤點的組(同 api:開始數那一刻的系統數字、B6 要重數、處理對不上 / 還沒處理完)
    const counted = countReviewOf(draft, {
      sheet,
      systemOf,
      countSales,
      staleGroups: options.staleGroups ?? [],
    });
    stale += counted.stale;
    unhandled += counted.unhandled;
    backfillCount += counted.backfillCount;
    backfillAmount += counted.backfillAmount;
    investigate += counted.investigate;
    flagged += counted.flagged;
    const countLines = counted.lines;
    const uncountedGroups = counted.uncountedGroups;
    // 範圍內(單一收銀點 / 全店)檯面上還沒盤的本(同 api:不比對,只記下來)
    const uncountedCount =
      uncountedGroups +
      sheet.books.filter(
        (book) =>
          (draft.scopeCashPointId === null ||
            book.cashPointId === draft.scopeCashPointId) &&
          !draft.lines.some(
            (line) =>
              line.bookId === book.bookId &&
              line.cashPointId === book.cashPointId,
          ),
      ).length;
    return {
      __typename: "LotteryStocktakeReview",
      lines,
      countLines,
      uncountedCount,
      staleCount: stale,
      unhandledCount: unhandled,
      summary: {
        __typename: "LotteryStocktakeSummary",
        books: lines.length,
        backfillCount,
        backfillAmount,
        newInvestigate: investigate + unopenedAbsent,
        flagged,
        uncountedCount,
        confirmLost: lost.length,
        confirmLostCost: lost.length * 184,
      },
    };
  };

  const handlers = [
    ...rescan.handlers,
    // 單一收銀點:只回那個收銀點與它檯面上的本,沒有未拆的本與待查清單(同 api)
    api.query("LotteryStocktakeSheet", ({ variables }) => {
      const { input } = variables as LotteryStocktakeSheetQueryVariables;
      const scope = input.cashPointId ?? null;
      return HttpResponse.json({
        data: {
          lotteryStocktakeSheet:
            scope === null
              ? sheet
              : {
                  ...sheet,
                  cashPoints: sheet.cashPoints.filter(
                    (point) => point.id === scope,
                  ),
                  books: sheet.books.filter(
                    (item) => item.cashPointId === scope,
                  ),
                  countGroups: sheet.countGroups.filter(
                    (group) => group.cashPointId === scope,
                  ),
                  unopenedBooks: [],
                  lostTickets: [],
                },
        },
      });
    }),
    api.query("LotteryStocktakeReview", ({ variables }) => {
      const { input } = variables as LotteryStocktakeReviewQueryVariables;
      const parsed = parseStocktakeDraft(input.draft);
      if (!parsed.ok) {
        return graphqlError("VALIDATION_FAILED", "STOCKTAKE_DRAFT_INVALID", {
          reason: "STOCKTAKE_DRAFT_INVALID",
          fields: ["draft"],
        });
      }
      inputs.reviews.push(parsed.draft);
      return HttpResponse.json({
        data: { lotteryStocktakeReview: reviewOf(parsed.draft) },
      });
    }),
    api.mutation("BackfillLotteryStocktakeSales", ({ variables }) => {
      const { input } =
        variables as BackfillLotteryStocktakeSalesMutationVariables;
      inputs.backfill.push(input);
      const processed = input.tickets.filter((ref) =>
        (options.processedTicketIds ?? []).includes(ref.ticketId),
      );
      if (processed.length > 0) {
        return apiError("CONFLICT", {
          reason: "STOCKTAKE_ALREADY_PROCESSED",
          tickets: processed.map((ref) => ref.ticketId),
        });
      }
      const items = input.tickets.flatMap((ref) => {
        const book = bookOfTicket(sheet, ref.ticketId);
        const ticket = book?.tickets.find(
          (item) => item.ticketId === ref.ticketId,
        );
        if (book === undefined || ticket === undefined) {
          return [];
        }
        ticket.status = "sold";
        ticket.version += 1;
        backfilled.add(ticket.ticketId);
        const point = sheet.cashPoints.find(
          (item) => item.id === book.cashPointId,
        );
        if (point?.shift != null) {
          point.shift.expectedCash =
            (point.shift.expectedCash ?? 0) + book.unitPrice;
        }
        return [
          {
            __typename: "LotteryStocktakeBackfill" as const,
            ticketId: ticket.ticketId,
            ticketNo: ticket.ticketNo,
            eventId: `${ticket.ticketId}:${String(ticket.version)}`,
            amount: book.unitPrice,
            cashPointId: book.cashPointId,
            shiftId: point?.shift?.id ?? point?.lastShift?.id ?? "",
            postClose: point?.shift == null,
          },
        ];
      });
      return HttpResponse.json({
        data: {
          backfillLotteryStocktakeSales: {
            __typename: "LotteryStocktakeBackfillPayload",
            items,
          },
        },
      });
    }),
    ...countStocktakeHandlers({ sheet, sessions, countSales, inputs }),
    api.query("LotteryStocktakeStatus", () =>
      HttpResponse.json({
        data: {
          lotteryStocktakeStatus: {
            __typename: "LotteryStocktakeStatus",
            lastSubmittedAt: "2026-10-13T14:20:00.000Z",
            remind: options.remind ?? true,
            rescans:
              rescan.state.rescan?.status === "in_progress"
                ? [rescanBriefOf(rescan.state.rescan)]
                : [],
            rescanReminders: [...(options.rescanReminders ?? [])],
          },
        },
      }),
    ),
    api.query("LotteryStocktakes", ({ variables }) => {
      const { input } = variables as LotteryStocktakesQueryVariables;
      const rows = sampleStocktakeList().filter(
        (row) =>
          (input.type == null || row.type === input.type) &&
          (input.status == null || row.status === input.status),
      );
      return HttpResponse.json({
        data: {
          lotteryStocktakes: {
            __typename: "LotteryStocktakesPayload",
            total: rows.length,
            items: rows,
          },
        },
      });
    }),
    api.query("LotteryStocktake", ({ variables }) => {
      const { submissionId } = variables as LotteryStocktakeQueryVariables;
      if (submissionId !== STOCKTAKE_REVIEWING_ID) {
        return apiError("NOT_FOUND", {});
      }
      return HttpResponse.json({
        data: {
          lotteryStocktake:
            options.countMode === true
              ? sampleCountStocktakeDetail()
              : sampleStocktakeDetail(),
        },
      });
    }),
  ];
  return { handlers, rescan, state: { sheet, backfilled, sessions }, inputs };
};
