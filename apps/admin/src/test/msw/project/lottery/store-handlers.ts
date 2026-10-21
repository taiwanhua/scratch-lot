import { HttpResponse } from "msw";

import type {
  DepositLotteryShiftCashMutationVariables,
  LotteryShiftInfoQueryVariables,
  LotteryStoreBoardQueryVariables,
  LotteryStoreOpenShiftFormQueryVariables,
  OpenLotteryShiftMutationVariables,
  ReassignLotteryShiftEntryMutationVariables,
  WithdrawLotteryShiftCashMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api, type server } from "../../server";
import {
  STORE_CLERK,
  type StoreBoard,
  sampleOpenShiftForm,
  sampleShiftInfo,
  sampleStoreBoard,
  storeShift,
} from "./store-fixtures";

export interface StoreWorldOptions {
  board?: StoreBoard;
}

export interface StoreWorld {
  handlers: Parameters<typeof server.use>;
  /** 看板的狀態(銷售的假 api `storeSalesWorld` 售出 / 撤銷時跟著改本班已售、應有現金與剩餘張數) */
  state: StoreBoard;
  inputs: {
    open: OpenLotteryShiftMutationVariables["input"][];
    deposit: DepositLotteryShiftCashMutationVariables["input"][];
    withdraw: WithdrawLotteryShiftCashMutationVariables["input"][];
    reassign: ReassignLotteryShiftEntryMutationVariables["input"][];
  };
}

const validation = (reason: string, fields: string[]) =>
  graphqlError("VALIDATION_FAILED", reason, { reason, fields });

/**
 * 店面管理的假 api(夾具在 `store-fixtures.ts`;規則照 `docs/modules/project/store.md`):有狀態 ——
 * 開班後看板出現那一班、投庫 / 出庫後應有現金跟著變;投庫超過抽屜應有 → `AMOUNT_EXCEEDS_DRAWER`;出庫 / 開班領零用金超過小金庫應有 → `AMOUNT_EXCEEDS_VAULT`;
 * 已開班的收銀點再開班 → `SHIFT_ALREADY_OPEN`。元件測試與 mock 模式共用。
 */
export const storeWorld = ({
  board = sampleStoreBoard(),
}: StoreWorldOptions = {}): StoreWorld => {
  const state = structuredClone(board);
  const inputs: StoreWorld["inputs"] = {
    open: [],
    deposit: [],
    withdraw: [],
    reassign: [],
  };
  const shiftById = (id: string) =>
    state.cashPoints.find((point) => point.shift?.id === id)?.shift ?? null;
  const shiftPayload = (id: string) => {
    const shift = shiftById(id);
    return shift === null
      ? null
      : { __typename: "LotteryStoreShiftPayload" as const, item: shift };
  };

  const handlers = [
    api.query("LotteryStoreBoard", ({ variables }) => {
      const { orgId } = variables as LotteryStoreBoardQueryVariables;
      return HttpResponse.json({
        data: {
          lotteryStoreBoard: {
            item: { ...state, org: { ...state.org, id: orgId } },
          },
        },
      });
    }),
    api.query("LotteryStoreOpenShiftForm", ({ variables }) => {
      const { cashPointId } =
        variables as LotteryStoreOpenShiftFormQueryVariables;
      const point = state.cashPoints.find((item) => item.id === cashPointId);
      if (point === undefined) {
        return graphqlError("FORBIDDEN", "NOT_FOUND", { code: "NOT_FOUND" });
      }
      return HttpResponse.json({
        data: {
          lotteryStoreOpenShiftForm: {
            item: sampleOpenShiftForm(point.id, point.name, point.positionKey),
          },
        },
      });
    }),
    api.mutation("OpenLotteryShift", ({ variables }) => {
      const { input } = variables as OpenLotteryShiftMutationVariables;
      inputs.open.push(input);
      const point = state.cashPoints.find(
        (item) => item.id === input.cashPointId,
      );
      if (point === undefined) {
        return graphqlError("FORBIDDEN", "NOT_FOUND", { code: "NOT_FOUND" });
      }
      if (point.shift != null) {
        return validation("SHIFT_ALREADY_OPEN", ["cashPointId"]);
      }
      const float = input.floatFromVault ?? 0;
      if (float > state.vaultExpected) {
        return validation("AMOUNT_EXCEEDS_VAULT", ["floatFromVault"]);
      }
      const shift = storeShift({
        id: `shift-${point.id}`,
        cashPoint: {
          __typename: "LotteryAccountsRef",
          id: point.id,
          name: point.name,
        },
        openedBy: { __typename: "LotteryAccountsRef", ...STORE_CLERK },
        openedAt: new Date().toISOString(),
        openingFloat: float,
        expectedCash: float,
        unmatchedEntry: input.temporaryCover,
      });
      point.shift = shift;
      state.myOpenShifts.push(shift);
      state.vaultExpected -= float;
      return HttpResponse.json({
        data: { openLotteryShift: shiftPayload(shift.id) },
      });
    }),
    api.mutation("PunchLotteryShiftStart", ({ variables }) =>
      HttpResponse.json({
        data: {
          punchLotteryShiftStart: {
            entryId: String(variables.entryId),
            at: new Date().toISOString(),
          },
        },
      }),
    ),
    api.query("LotteryShiftInfo", ({ variables }) => {
      const { id } = variables as LotteryShiftInfoQueryVariables;
      const shift = shiftById(id);
      if (shift === null) {
        return graphqlError("FORBIDDEN", "NOT_FOUND", { code: "NOT_FOUND" });
      }
      return HttpResponse.json({
        data: { lotteryShiftInfo: { item: sampleShiftInfo(shift) } },
      });
    }),
    api.mutation("ReassignLotteryShiftEntry", ({ variables }) => {
      const { input } = variables as ReassignLotteryShiftEntryMutationVariables;
      inputs.reassign.push(input);
      const shift = shiftById(input.shiftId);
      if (shift === null) {
        return graphqlError("FORBIDDEN", "NOT_FOUND", { code: "NOT_FOUND" });
      }
      shift.unmatchedEntry = input.temporaryCover;
      return HttpResponse.json({
        data: { reassignLotteryShiftEntry: { item: sampleShiftInfo(shift) } },
      });
    }),
    api.mutation("DepositLotteryShiftCash", ({ variables }) => {
      const { input } = variables as DepositLotteryShiftCashMutationVariables;
      inputs.deposit.push(input);
      const shift = shiftById(input.shiftId);
      if (shift === null) {
        return graphqlError("FORBIDDEN", "NOT_FOUND", { code: "NOT_FOUND" });
      }
      if (input.amount > shift.expectedCash) {
        return validation("AMOUNT_EXCEEDS_DRAWER", ["amount"]);
      }
      shift.expectedCash -= input.amount;
      state.vaultExpected += input.amount;
      return HttpResponse.json({
        data: { depositLotteryShiftCash: shiftPayload(shift.id) },
      });
    }),
    api.mutation("WithdrawLotteryShiftCash", ({ variables }) => {
      const { input } = variables as WithdrawLotteryShiftCashMutationVariables;
      inputs.withdraw.push(input);
      const shift = shiftById(input.shiftId);
      if (shift === null) {
        return graphqlError("FORBIDDEN", "NOT_FOUND", { code: "NOT_FOUND" });
      }
      if (input.amount > state.vaultExpected) {
        return validation("AMOUNT_EXCEEDS_VAULT", ["amount"]);
      }
      shift.expectedCash += input.amount;
      state.vaultExpected -= input.amount;
      return HttpResponse.json({
        data: { withdrawLotteryShiftCash: shiftPayload(shift.id) },
      });
    }),
  ];
  return { handlers, inputs, state };
};
