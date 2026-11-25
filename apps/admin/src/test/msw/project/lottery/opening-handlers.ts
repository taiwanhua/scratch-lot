import { HttpResponse } from "msw";

import { LOTTERY_SETTINGS_PERMISSIONS } from "@repo/domain/project/lottery-settings";
import type {
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
}

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
  ];

  return { handlers, inputs, openingOf };
};
