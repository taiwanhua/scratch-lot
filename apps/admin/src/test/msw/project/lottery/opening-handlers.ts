import { HttpResponse } from "msw";

import { LOTTERY_SETTINGS_PERMISSIONS } from "@repo/domain/project/lottery-settings";
import type {
  CreateLotteryOpeningBookMutationVariables,
  LotteryOpeningScanQuery,
  LotteryStoreOpeningFieldsFragment,
  ReopenLotteryStoreOpeningMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api } from "../../server";

/** 期初建檔權限(庫存管理) */
export const OPENING_PERMISSION = "inventory.opening";

/** 一家店的期初建檔狀態;沒給 = 進行中、0 本。 */
export interface OpeningState {
  bookCount: number;
  closedAt?: string;
  closedBy?: string;
  books?: LotteryStoreOpeningFieldsFragment["books"];
}

export interface OpeningWorldOptions {
  /** 讀得到要 `inventory.opening` 或 `lottery-settings.edit-org`;結束 / 重新開放要 `edit-org` */
  permissions: readonly string[];
  /** 分店 id → 狀態 */
  openings?: Record<string, OpeningState>;
  nameOf: (orgId: string) => string;
  /** 刷到的碼 → 掃描結果(期初建檔頁);沒列的碼 = 看不懂 */
  scans?: Record<string, OpeningScanResult>;
}

export type OpeningScanResult = LotteryOpeningScanQuery["lotteryOpeningScan"];
type OpeningCandidate = OpeningScanResult["candidates"][number];

/** 掃描候選(預設 556 好運 100 張、面額 10,000、92%、可以建)。 */
export const openingCandidate = (
  overrides: Partial<OpeningCandidate> = {},
): OpeningCandidate => ({
  __typename: "LotteryOpeningScanCandidate",
  gameId: "g-556",
  gameCode: "556",
  gameName: "好運",
  ticketsPerBook: 100,
  bookPrice: 10_000,
  defaultRate: 92,
  discontinued: false,
  block: null,
  bookId: null,
  serialNo: null,
  ...overrides,
});

const forbidden = () =>
  graphqlError("FORBIDDEN", "missing permission", {
    reason: "MISSING_PERMISSION",
  });

const ref = (id: string, name: string) => ({
  __typename: "LotteryInventoryRef" as const,
  id,
  name,
});

/**
 * 期初建檔的假 api(有狀態;正本 `apps/api/src/project/lottery/inventory/opening/`):分店狀態、
 * [結束期初建檔]、[重新開放]。刮刮樂設定與期初建檔頁共用。
 */
export const openingWorld = (options: OpeningWorldOptions) => {
  const { permissions, nameOf } = options;
  const openings = new Map(Object.entries(options.openings ?? {}));
  const canClose = permissions.includes(LOTTERY_SETTINGS_PERMISSIONS.editOrg);
  const canRead = canClose || permissions.includes(OPENING_PERMISSION);
  const inputs = {
    close: [] as string[],
    reopen: [] as ReopenLotteryStoreOpeningMutationVariables["input"][],
    create: [] as CreateLotteryOpeningBookMutationVariables["input"][],
    void: [] as string[],
  };
  const stateOf = (orgId: string): OpeningState =>
    openings.get(orgId) ?? { bookCount: 0 };
  const openingOf = (orgId: string): LotteryStoreOpeningFieldsFragment => {
    const state = stateOf(orgId);
    const closedAt = state.closedAt ?? null;
    return {
      __typename: "LotteryStoreOpening",
      org: ref(orgId, nameOf(orgId)),
      closed: closedAt !== null,
      closedAt,
      closedBy:
        state.closedBy === undefined ? null : ref("u-hq", state.closedBy),
      startedAt: null,
      history: [],
      bookCount: state.bookCount,
      books: state.books ?? [],
      canOpen: permissions.includes(OPENING_PERMISSION) && closedAt === null,
      canClose,
      canShowCost: false,
      cashPoints: [ref("cp-counter", "店內櫃台")],
    };
  };
  const handlers = [
    api.query("LotteryStoreOpening", ({ variables }) => {
      const { orgId } = variables as { orgId: string };
      if (!canRead) {
        return forbidden();
      }
      return HttpResponse.json({
        data: { lotteryStoreOpening: { item: openingOf(orgId) } },
      });
    }),
    api.mutation("CloseLotteryStoreOpening", ({ variables }) => {
      const { orgId } = variables as { orgId: string };
      inputs.close.push(orgId);
      if (!canClose) {
        return forbidden();
      }
      const state = stateOf(orgId);
      if (state.closedAt !== undefined) {
        return graphqlError("CONFLICT", "already closed", {
          reason: "STORE_OPENING_STATE_MISMATCH",
        });
      }
      openings.set(orgId, {
        ...state,
        closedAt: "2026-11-30T02:00:00.000Z",
        closedBy: "王總部",
      });
      return HttpResponse.json({
        data: { closeLotteryStoreOpening: { item: openingOf(orgId) } },
      });
    }),
    api.mutation<
      Record<string, unknown>,
      ReopenLotteryStoreOpeningMutationVariables
    >("ReopenLotteryStoreOpening", ({ variables }) => {
      inputs.reopen.push(variables.input);
      if (!canClose) {
        return forbidden();
      }
      const { orgId } = variables.input;
      const { bookCount, books } = stateOf(orgId);
      openings.set(orgId, { bookCount, ...(books ? { books } : {}) });
      return HttpResponse.json({
        data: { reopenLotteryStoreOpening: { item: openingOf(orgId) } },
      });
    }),
    api.query("LotteryOpeningScan", ({ variables }) => {
      const { input } = variables as { input: { code: string } };
      const result = options.scans?.[input.code] ?? {
        __typename: "LotteryOpeningScanPayload" as const,
        bookNo: null,
        topTicketNo: null,
        hasGameCode: false,
        candidates: [],
      };
      return HttpResponse.json({ data: { lotteryOpeningScan: result } });
    }),
    api.mutation<
      Record<string, unknown>,
      CreateLotteryOpeningBookMutationVariables
    >("CreateLotteryOpeningBook", ({ variables }) => {
      const { input } = variables;
      inputs.create.push(input);
      const state = stateOf(input.orgId);
      if (state.closedAt !== undefined) {
        return graphqlError("VALIDATION_FAILED", "closed", {
          reason: "STORE_OPENING_CLOSED",
        });
      }
      const bookId = `ob-${String(inputs.create.length)}`;
      const inHand =
        input.lastTicketNo -
        input.soldTicketNos.length -
        input.skippedTicketNos.length;
      const book: LotteryStoreOpeningFieldsFragment["books"][number] = {
        __typename: "LotteryOpeningBook",
        bookId,
        bookKey: `556-${input.bookNo}`,
        gameCode: "556",
        gameName: "好運",
        bookNo: input.bookNo,
        lastTicketNo: String(input.lastTicketNo),
        openingSoldCount: input.soldTicketNos.length,
        inHandCount: inHand,
        places: input.placements.map((placement) => ({
          __typename: "LotteryOpeningPlace" as const,
          cashPoint:
            placement.cashPointId == null
              ? null
              : ref(placement.cashPointId, "店內櫃台"),
          count: placement.ticketNos.length,
        })),
        openedBy: ref("u-manager", "王店長"),
        openingAt: "2026-11-25T01:12:00.000Z",
        voidable: true,
      };
      openings.set(input.orgId, {
        ...state,
        bookCount: state.bookCount + 1,
        books: [book, ...(state.books ?? [])],
      });
      return HttpResponse.json({
        data: {
          createLotteryOpeningBook: { bookId, count: input.lastTicketNo },
        },
      });
    }),
    api.mutation("VoidLotteryOpeningBook", ({ variables }) => {
      const { bookId } = variables as { bookId: string };
      inputs.void.push(bookId);
      for (const [orgId, state] of openings) {
        const book = state.books?.find((item) => item.bookId === bookId);
        if (book !== undefined) {
          if (!book.voidable) {
            return graphqlError("VALIDATION_FAILED", "not voidable", {
              reason: "OPENING_NOT_VOIDABLE",
            });
          }
          openings.set(orgId, {
            ...state,
            bookCount: state.bookCount - 1,
            books: (state.books ?? []).filter((item) => item !== book),
          });
        }
      }
      return HttpResponse.json({
        data: { voidLotteryOpeningBook: { bookId, count: 100 } },
      });
    }),
  ];

  return { handlers, inputs, openingOf };
};
