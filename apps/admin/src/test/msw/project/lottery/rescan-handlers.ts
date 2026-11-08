import { type GraphQLResponseBody, HttpResponse } from "msw";

import { RESCAN_REASONS } from "@repo/domain/project/lottery";
import type {
  CancelLotteryRescanMutationVariables,
  FinishLotteryRescanPlaceMutationVariables,
  LotteryRescanFieldsFragment,
  LotteryRescanItemFieldsFragment,
  LotteryStocktakeStatusQuery,
  ScanLotteryRescanTicketMutationVariables,
  StartLotteryRescanMutationVariables,
} from "@repo/graphql";

import { api } from "../../server";

export type RescanFixture = LotteryRescanFieldsFragment;
export type RescanItemFixture = LotteryRescanItemFieldsFragment;
type Status = LotteryStocktakeStatusQuery["lotteryStocktakeStatus"];
export type RescanBriefFixture = Status["rescans"][number];
export type RescanReminderFixture = Status["rescanReminders"][number];

const place = (
  cashPointId: string | null,
  name: string,
): RescanFixture["places"][number] => ({
  __typename: "LotteryRescanPlace",
  cashPointId,
  name,
  state: "pending",
  scanningByName: null,
  mine: false,
  doneAt: null,
  doneByName: null,
  scannedCount: 0,
  items: [],
});

/** 一張刷到的張(5164 · 本號 0056528)。 */
export const rescanItem = (
  ticketNo: string,
  outcome: string,
  extra: Partial<RescanItemFixture> = {},
): RescanItemFixture => ({
  __typename: "LotteryRescanItem",
  ticketId: `t-${ticketNo}`,
  gameCode: "5164",
  bookNo: "0056528",
  ticketNo,
  outcome,
  partnerTicketNo: null,
  cashPointId: "cp-outdoor",
  ...extra,
});

/** 中山店的 5164 發大財全店重刷(王小明 10:20 開始;位置:店內櫃台、店外攤位、庫存)。 */
export const sampleRescan = (
  overrides: Partial<RescanFixture> = {},
): RescanFixture => ({
  __typename: "LotteryRescan",
  id: "rescan-1",
  orgId: "org-store-a",
  gameId: "g-5164",
  gameCode: "5164",
  gameName: "發大財",
  status: "in_progress",
  cancelCause: null,
  startedAt: "2026-10-13T02:20:00.000Z",
  startedByName: "王小明",
  finishedAt: null,
  minutesLeft: 52,
  canCancel: true,
  doneCount: 0,
  places: [
    place("cp-counter", "店內櫃台"),
    place("cp-outdoor", "店外攤位"),
    place(null, ""),
  ],
  results: [],
  ...overrides,
});

/** 看板 / 盤點頁的進行中重刷(`lotteryStocktakeStatus.rescans`)。 */
export const rescanBriefOf = (rescan: RescanFixture): RescanBriefFixture => ({
  __typename: "LotteryRescanBrief",
  id: rescan.id,
  gameId: rescan.gameId,
  gameCode: rescan.gameCode,
  gameName: rescan.gameName,
  startedByName: rescan.startedByName,
  startedAt: rescan.startedAt,
  minutesLeft: rescan.minutesLeft,
  doneCount: rescan.doneCount,
  places: rescan.places.map((item) => ({
    __typename: "LotteryRescanPlace" as const,
    cashPointId: item.cashPointId,
    name: item.name,
    state: item.state,
  })),
});

/** 全店重刷提醒(`lotteryStocktakeStatus.rescanReminders`)。 */
export const rescanReminder = (
  overrides: Partial<RescanReminderFixture> = {},
): RescanReminderFixture => ({
  __typename: "LotteryRescanReminder",
  gameId: "g-5164",
  gameCode: "5164",
  gameName: "發大財",
  investigateCount: 1,
  flaggedCount: 0,
  ...overrides,
});

export interface RescanWorldOptions {
  /** 進行中的那一次(重刷頁、看板橫幅);不給 = 沒有重刷 */
  rescan?: RescanFixture | null;
  /** 刷到的碼 → 結果(找不到 = 「找不到這張」) */
  codes?: Readonly<Record<string, RescanItemFixture>>;
  /** 刷這個位置被擋(例:有人盤點中) */
  scanError?: { reason: string; extensions?: Record<string, unknown> } | null;
}

export interface RescanWorld {
  handlers: ReturnType<typeof api.query>[];
  state: { rescan: RescanFixture | null };
  inputs: {
    start: StartLotteryRescanMutationVariables["input"][];
    scan: ScanLotteryRescanTicketMutationVariables["input"][];
    finish: FinishLotteryRescanPlaceMutationVariables["input"][];
    cancel: CancelLotteryRescanMutationVariables["input"][];
  };
}

const businessError = (
  reason: string,
  extensions: Record<string, unknown> = {},
) =>
  HttpResponse.json<GraphQLResponseBody<Record<string, never>>>({
    data: null,
    errors: [
      {
        message: reason,
        extensions: { code: "CONFLICT", reason, ...extensions },
      },
    ],
  });

/** 同一個位置(庫存 = null)。 */
const samePlace = (
  item: { cashPointId?: string | null },
  cashPointId: string | null | undefined,
) => (item.cashPointId ?? null) === (cashPointId ?? null);

/**
 * 全店重刷的假 api(張數店規格 8.4):開始 → 一次進行中的重刷;刷到的碼照 `codes` 回結果、加進那個位置的清單;
 * [這裡刷完了] → 那個位置刷完、結果記進摘要,全部刷完 → 完成;[取消重刷] → 取消。
 */
export const rescanWorld = (options: RescanWorldOptions = {}): RescanWorld => {
  const state = { rescan: options.rescan ?? null };
  const inputs: RescanWorld["inputs"] = {
    start: [],
    scan: [],
    finish: [],
    cancel: [],
  };
  const current = (): RescanFixture => {
    state.rescan ??= sampleRescan();
    return state.rescan;
  };
  return {
    state,
    inputs,
    handlers: [
      api.query("LotteryRescan", () =>
        HttpResponse.json({ data: { lotteryRescan: current() } }),
      ),
      api.mutation("StartLotteryRescan", ({ variables }) => {
        inputs.start.push(
          (variables as StartLotteryRescanMutationVariables).input,
        );
        state.rescan = sampleRescan();
        return HttpResponse.json({
          data: { startLotteryRescan: state.rescan },
        });
      }),
      api.mutation("ScanLotteryRescanTicket", ({ variables }) => {
        const input = (variables as ScanLotteryRescanTicketMutationVariables)
          .input;
        inputs.scan.push(input);
        if (options.scanError != null) {
          return businessError(
            options.scanError.reason,
            options.scanError.extensions,
          );
        }
        const found = options.codes?.[input.code];
        if (found === undefined) {
          return businessError(RESCAN_REASONS.notFound);
        }
        const rescan = current();
        const item = { ...found, cashPointId: input.cashPointId ?? null };
        const duplicate = rescan.places.some(
          (one) =>
            samePlace(one, input.cashPointId) &&
            one.items.some((other) => other.ticketId === item.ticketId),
        );
        state.rescan = {
          ...rescan,
          places: rescan.places.map((one) =>
            samePlace(one, input.cashPointId) && !duplicate
              ? {
                  ...one,
                  state: "scanning",
                  mine: true,
                  scanningByName: "王小明",
                  scannedCount: one.scannedCount + 1,
                  items: [...one.items, item],
                }
              : one,
          ),
        };
        return HttpResponse.json({
          data: {
            scanLotteryRescanTicket: {
              __typename: "LotteryRescanScanPayload",
              duplicate,
              item,
              rescan: state.rescan,
            },
          },
        });
      }),
      api.mutation("FinishLotteryRescanPlace", ({ variables }) => {
        const input = (variables as FinishLotteryRescanPlaceMutationVariables)
          .input;
        inputs.finish.push(input);
        const rescan = current();
        const target = rescan.places.find((one) =>
          samePlace(one, input.cashPointId),
        );
        const places = rescan.places.map((one) =>
          samePlace(one, input.cashPointId)
            ? {
                ...one,
                state: "done",
                scanningByName: null,
                mine: false,
                doneAt: "2026-10-13T02:32:00.000Z",
                doneByName: "王小明",
                items: one.items.filter((item) => item.outcome !== "ok"),
              }
            : one,
        );
        const finished = places.every((one) => one.state === "done");
        state.rescan = {
          ...rescan,
          places,
          doneCount: places.filter((one) => one.state === "done").length,
          results: [
            ...rescan.results,
            ...(target?.items ?? []).filter((item) => item.outcome !== "ok"),
          ],
          ...(finished
            ? {
                status: "finished",
                finishedAt: "2026-10-13T02:58:00.000Z",
                canCancel: false,
              }
            : {}),
        };
        return HttpResponse.json({
          data: { finishLotteryRescanPlace: state.rescan },
        });
      }),
      api.mutation("CancelLotteryRescan", ({ variables }) => {
        inputs.cancel.push(
          (variables as CancelLotteryRescanMutationVariables).input,
        );
        state.rescan = {
          ...current(),
          status: "cancelled",
          cancelCause: "manual",
          canCancel: false,
        };
        return HttpResponse.json({
          data: { cancelLotteryRescan: state.rescan },
        });
      }),
    ],
  };
};
