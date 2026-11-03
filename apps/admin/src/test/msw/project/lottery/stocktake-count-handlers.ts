import { type GraphQLResponseBody, HttpResponse } from "msw";

import {
  type StocktakeDraft,
  countDiffOf,
  countLineProblemOf,
} from "@repo/domain/project/lottery";
import type {
  BackfillLotteryStocktakeCountSalesMutationVariables,
  EndLotteryStocktakeSessionMutationVariables,
  LotteryStocktakeReviewQuery,
  LotteryStocktakeSessionFieldsFragment,
  SaveLotteryStocktakeSessionMutationVariables,
  StartLotteryStocktakeSessionMutationVariables,
} from "@repo/graphql";

import { api } from "../../server";
import type { StocktakeSheetFixture } from "./stocktake-fixtures";

type CountLine =
  LotteryStocktakeReviewQuery["lotteryStocktakeReview"]["countLines"][number];

/** 業務錯誤(GQL-04)。 */
const apiError = (code: string, extensions: Record<string, unknown>) =>
  HttpResponse.json<GraphQLResponseBody<Record<string, never>>>({
    data: null,
    errors: [{ message: code, extensions: { ...extensions, code } }],
  });

export type StocktakeSessionFixture = LotteryStocktakeSessionFieldsFragment;

/** 盤點中登記的示範資料(預設:別人的、店內櫃台、10:05 開始、剩 52 分鐘)。 */
export const sampleStocktakeSession = (
  overrides: Partial<StocktakeSessionFixture> = {},
): StocktakeSessionFixture => ({
  __typename: "LotteryStocktakeSession",
  sessionId: "session-li",
  type: "adhoc",
  wholeStore: false,
  cashPointId: "cp-counter",
  cashPointName: "店內櫃台",
  byId: "user-li",
  byName: "李小華",
  mine: false,
  canEnd: false,
  startedAt: "2026-10-16T02:05:00.000Z",
  lastActiveAt: "2026-10-16T02:05:00.000Z",
  expiresAt: "2026-10-16T03:05:00.000Z",
  minutesLeft: 52,
  live: true,
  ended: false,
  draft: null,
  ...overrides,
});

const overlaps = (
  session: Pick<StocktakeSessionFixture, "wholeStore" | "cashPointId">,
  cashPointId: string | null,
): boolean =>
  session.wholeStore ||
  cashPointId === null ||
  session.cashPointId === cashPointId;

/** 張數盤點的假 api 共用的狀態(`stocktakeWorld` 給)。 */
export interface CountStocktakeContext {
  sheet: StocktakeSheetFixture;
  sessions: StocktakeSessionFixture[];
  /** 算售出寫的張數(依 refId) */
  countSales: Map<string, number>;
  inputs: {
    countBackfill: BackfillLotteryStocktakeCountSalesMutationVariables["input"][];
    sessionStarts: StartLotteryStocktakeSessionMutationVariables["input"][];
    sessionSaves: SaveLotteryStocktakeSessionMutationVariables["input"][];
    sessionEnds: EndLotteryStocktakeSessionMutationVariables["input"][];
  };
}

/** 差異核對的張數盤點(同 api 的 `countLineFactsOf` / `countLineProblemOf`)。 */
export const countReviewOf = (
  draft: StocktakeDraft,
  context: {
    sheet: StocktakeSheetFixture;
    systemOf: ReadonlyMap<string, number>;
    countSales: ReadonlyMap<string, number>;
    staleGroups: readonly string[];
  },
) => {
  const { sheet, systemOf, countSales } = context;
  let stale = 0;
  let unhandled = 0;
  let backfillCount = 0;
  let backfillAmount = 0;
  let investigate = 0;
  let flagged = 0;
  const lines: CountLine[] = (draft.countLines ?? []).flatMap((line) => {
    const key = `${line.cashPointId}:${line.gameId}`;
    const group = sheet.countGroups.find(
      (item) =>
        item.cashPointId === line.cashPointId && item.gameId === line.gameId,
    );
    if (group === undefined) {
      return [];
    }
    const facts = {
      systemCount: systemOf.get(key) ?? 0,
      ownSaleCount: line.saleRefIds.reduce(
        (sum, refId) => sum + (countSales.get(refId) ?? 0),
        0,
      ),
      touchedByOther: context.staleGroups.includes(key),
    };
    const problem = countLineProblemOf(facts, line);
    const diff = countDiffOf(facts.systemCount, line.presentCount);
    stale += problem === "stale" ? 1 : 0;
    unhandled += problem === "unhandled" ? 1 : 0;
    backfillCount += facts.ownSaleCount;
    backfillAmount += facts.ownSaleCount * group.unitPrice;
    investigate += line.investigateCount;
    flagged += line.flagged && diff.kind === "over" ? diff.count : 0;
    return [
      {
        __typename: "LotteryStocktakeReviewCountLine" as const,
        cashPointId: line.cashPointId,
        cashPointName:
          sheet.cashPoints.find((point) => point.id === line.cashPointId)
            ?.name ?? "",
        gameId: line.gameId,
        gameCode: group.gameCode,
        gameName: group.gameName,
        unitPrice: group.unitPrice,
        systemCount: facts.systemCount,
        presentCount: line.presentCount,
        kind: diff.kind,
        diffCount: diff.count,
        saleCount: facts.ownSaleCount,
        stale: problem === "stale",
        unhandled: problem === "unhandled",
      },
    ];
  });
  const uncountedGroups = sheet.countGroups.filter(
    (group) =>
      (draft.scopeCashPointId === null ||
        group.cashPointId === draft.scopeCashPointId) &&
      !(draft.countLines ?? []).some(
        (line) =>
          line.cashPointId === group.cashPointId &&
          line.gameId === group.gameId,
      ),
  ).length;
  return {
    lines,
    uncountedGroups,
    stale,
    unhandled,
    backfillCount,
    backfillAmount,
    investigate,
    flagged,
  };
};

/** 張數盤點的 [算售出]、盤點中登記的假 api(張數店規格 8.2、8.5a)。 */
export const countStocktakeHandlers = ({
  sheet,
  sessions,
  countSales,
  inputs,
}: CountStocktakeContext) => [
  // [算售出 N 張](立即生效):那一組的未售少 N 張、開著的班應有現金增加
  api.mutation("BackfillLotteryStocktakeCountSales", ({ variables }) => {
    const { input } =
      variables as BackfillLotteryStocktakeCountSalesMutationVariables;
    inputs.countBackfill.push(input);
    const group = sheet.countGroups.find(
      (item) =>
        item.cashPointId === input.cashPointId && item.gameId === input.gameId,
    );
    if (group === undefined || group.unsoldCount < input.count) {
      return apiError("VALIDATION_FAILED", {
        reason: "STOCKTAKE_COUNT_SALE_UNAVAILABLE",
        available: group?.unsoldCount ?? 0,
      });
    }
    group.unsoldCount -= input.count;
    const refId = `count-sale-${String(inputs.countBackfill.length)}`;
    countSales.set(refId, input.count);
    const point = sheet.cashPoints.find(
      (item) => item.id === input.cashPointId,
    );
    if (point?.shift != null) {
      point.shift.expectedCash =
        (point.shift.expectedCash ?? 0) + group.unitPrice * input.count;
    }
    return HttpResponse.json({
      data: {
        backfillLotteryStocktakeCountSales: {
          __typename: "LotteryStocktakeCountBackfill",
          refId,
          count: input.count,
          amount: group.unitPrice * input.count,
          shiftId: point?.shift?.id ?? point?.lastShift?.id ?? "",
          postClose: point?.shift == null,
        },
      },
    });
  }),
  // 盤點中登記(張數店規格 8.5a):別人的、有效的、位置重疊 → 擋;自己的 → 接續
  api.query("LotteryStocktakeSessions", () =>
    HttpResponse.json({
      data: {
        lotteryStocktakeSessions: {
          __typename: "LotteryStocktakeSessions",
          serverNow: "2026-10-16T02:13:00.000Z",
          items: sessions.filter((item) => item.live || item.mine),
        },
      },
    }),
  ),
  api.mutation("StartLotteryStocktakeSession", ({ variables }) => {
    const { input } =
      variables as StartLotteryStocktakeSessionMutationVariables;
    inputs.sessionStarts.push(input);
    const resumeId = input.sessionId ?? null;
    const resumed = sessions.find((item) => item.sessionId === resumeId);
    const scope =
      resumed?.wholeStore === true
        ? null
        : (resumed?.cashPointId ?? input.cashPointId ?? null);
    const blocking = sessions.find(
      (item) =>
        item.live && item.sessionId !== resumeId && overlaps(item, scope),
    );
    if (blocking !== undefined) {
      return apiError("CONFLICT", {
        reason: blocking.mine
          ? "STOCKTAKE_SESSION_OWN"
          : "STOCKTAKE_SESSION_BUSY",
        session: blocking,
      });
    }
    if (resumed !== undefined) {
      Object.assign(resumed, { live: true, ended: false, minutesLeft: 60 });
      return HttpResponse.json({
        data: { startLotteryStocktakeSession: resumed },
      });
    }
    const created = sampleStocktakeSession({
      sessionId: `session-${String(inputs.sessionStarts.length)}`,
      type: input.type,
      wholeStore: scope === null,
      cashPointId: scope,
      cashPointName:
        scope === null
          ? null
          : (sheet.cashPoints.find((point) => point.id === scope)?.name ?? ""),
      byId: "user-wang",
      byName: "王小明",
      mine: true,
      minutesLeft: 60,
    });
    sessions.push(created);
    return HttpResponse.json({
      data: { startLotteryStocktakeSession: created },
    });
  }),
  api.mutation("SaveLotteryStocktakeSession", ({ variables }) => {
    const { input } = variables as SaveLotteryStocktakeSessionMutationVariables;
    inputs.sessionSaves.push(input);
    const found = sessions.find((item) => item.sessionId === input.sessionId);
    if (found === undefined || found.ended) {
      return apiError("CONFLICT", { reason: "STOCKTAKE_SESSION_ENDED" });
    }
    found.draft = input.draft;
    found.minutesLeft = 60;
    return HttpResponse.json({
      data: { saveLotteryStocktakeSession: found },
    });
  }),
  api.mutation("EndLotteryStocktakeSession", ({ variables }) => {
    const { input } = variables as EndLotteryStocktakeSessionMutationVariables;
    inputs.sessionEnds.push(input);
    const found = sessions.find((item) => item.sessionId === input.sessionId);
    if (found?.mine === true) {
      sessions.splice(sessions.indexOf(found), 1);
    } else if (found !== undefined) {
      Object.assign(found, { live: false, ended: true, canEnd: false });
    }
    return HttpResponse.json({
      data: { endLotteryStocktakeSession: true },
    });
  }),
];
