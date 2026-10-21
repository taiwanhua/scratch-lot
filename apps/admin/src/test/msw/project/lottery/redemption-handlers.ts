import { HttpResponse } from "msw";

import {
  REDEMPTION_MAX_PRIZE,
  parseTicketInput,
} from "@repo/domain/project/lottery";
import type {
  LotteryPurchaseRedemptionRecordsQueryVariables,
  LotteryPurchaseRedemptionsQueryVariables,
  LotteryRecentRedemptionsQueryVariables,
  LotteryRedemptionPreviewQueryVariables,
  LotteryRedemptionQueryVariables,
  LotteryRedemptionsQueryVariables,
  RedeemLotteryTicketMutationVariables,
  ReplaceLotteryRedemptionMutationVariables,
  RevokeLotteryRedemptionMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api, type server } from "../../server";
import {
  type RedemptionFixture,
  redemptionRow,
  sampleRedemptions,
} from "./redemption-fixtures";
import { STORE_CLERK } from "./store-fixtures";

export interface RedemptionWorld {
  handlers: Parameters<typeof server.use>;
  inputs: {
    redeem: RedeemLotteryTicketMutationVariables["input"][];
    revoke: RevokeLotteryRedemptionMutationVariables["input"][];
    replace: ReplaceLotteryRedemptionMutationVariables["input"][];
  };
}

const validation = (reason: string, fields: string[], extra = {}) =>
  graphqlError("VALIDATION_FAILED", reason, { reason, fields, ...extra });

/**
 * 兌獎的假 api(夾具在 `redemption-fixtures.ts`;規則照 `docs/modules/project/store.md`「兌獎」):有狀態 ——
 * 兌獎後 [最近兌獎] 與兌獎紀錄多一筆、撤銷後改「已撤銷」;單張超過 5,000 → `REDEMPTION_OVER_LIMIT`;
 * 同一張未撤銷的再兌 → `REDEMPTION_DUPLICATE`;已送兌撤銷 → `REDEMPTION_SENT`。元件測試與 mock 模式共用。
 * 看板的應有現金不跟著變(看板在 `store-handlers.ts`)。
 */
/** 編號 → 那一張;正面的碼沒有遊戲代號時當成 5164(夾具只有這一款在本店)。 */
const ticketOf = (code: string) => {
  const parsed = parseTicketInput(code);
  return parsed === null
    ? null
    : { ...parsed, gameCode: parsed.gameCode ?? "5164" };
};

export const redemptionWorld = (
  rows: RedemptionFixture[] = sampleRedemptions(),
): RedemptionWorld => {
  const state = structuredClone(rows);
  const inputs: RedemptionWorld["inputs"] = {
    redeem: [],
    revoke: [],
    replace: [],
  };
  let sequence = 0;

  const activeOf = (ticket: NonNullable<ReturnType<typeof ticketOf>>) =>
    state.find(
      (row) =>
        row.status !== "revoked" &&
        row.gameCode === ticket.gameCode &&
        row.bookNo === ticket.bookNo &&
        row.ticketNo === ticket.ticketNo,
    ) ?? null;

  const create = (
    shiftId: string,
    code: string,
    prizeAmount: number,
  ): RedemptionFixture | Response => {
    const ticket = ticketOf(code);
    if (ticket === null) {
      return validation("REDEMPTION_CODE_INVALID", ["code"]);
    }
    if (prizeAmount > REDEMPTION_MAX_PRIZE) {
      return validation("REDEMPTION_OVER_LIMIT", ["prizeAmount"]);
    }
    const existing = activeOf(ticket);
    if (existing !== null) {
      return validation("REDEMPTION_DUPLICATE", ["code"], {
        redeemedAt: existing.redeemedAt,
        cashPointName: existing.cashPoint.name,
      });
    }
    sequence += 1;
    const row = redemptionRow({
      id: `rd-new-${String(sequence)}`,
      gameCode: ticket.gameCode,
      bookNo: ticket.bookNo,
      ticketNo: ticket.ticketNo,
      prizeAmount,
      redeemedAt: new Date().toISOString(),
      shift: {
        id: shiftId,
        name: STORE_CLERK.name,
        openedAt: "2026-10-16T00:02:00.000Z",
        closed: false,
      },
    });
    state.unshift(row);
    return row;
  };

  const revoke = (id: string): RedemptionFixture | Response => {
    const row = state.find((item) => item.id === id);
    if (row === undefined) {
      return graphqlError("FORBIDDEN", "NOT_FOUND", { code: "NOT_FOUND" });
    }
    if (row.status === "sent") {
      return validation("REDEMPTION_SENT", ["id"]);
    }
    if (row.status === "revoked") {
      return validation("REDEMPTION_ALREADY_REVOKED", ["id"]);
    }
    row.status = "revoked";
    row.revokedAt = new Date().toISOString();
    row.revokeMode = null;
    return row;
  };

  const handlers = [
    api.query("LotteryRedemptionPreview", ({ variables }) => {
      const { input } = variables as LotteryRedemptionPreviewQueryVariables;
      const ticket = ticketOf(input.code);
      if (ticket === null) {
        return validation("REDEMPTION_CODE_INVALID", ["code"]);
      }
      const existing = activeOf(ticket);
      const sample = redemptionRow({
        id: "preview",
        gameCode: ticket.gameCode,
        bookNo: ticket.bookNo,
        ticketNo: ticket.ticketNo,
        prizeAmount: 0,
        redeemedAt: new Date().toISOString(),
      });
      return HttpResponse.json({
        data: {
          lotteryRedemptionPreview: {
            item: {
              __typename: "LotteryRedemptionPreview",
              gameCode: sample.gameCode,
              gameName: sample.gameName,
              unitPrice: 200,
              bookNo: sample.bookNo,
              ticketNo: sample.ticketNo,
              ticketLabel: sample.ticketLabel,
              isOwnStore: true,
              existing:
                existing === null
                  ? null
                  : {
                      __typename: "LotteryRedemptionExisting",
                      redeemedAt: existing.redeemedAt,
                      cashPointName: existing.cashPoint.name,
                    },
            },
          },
        },
      });
    }),
    api.mutation("RedeemLotteryTicket", ({ variables }) => {
      const { input } = variables as RedeemLotteryTicketMutationVariables;
      inputs.redeem.push(input);
      const result = create(input.shiftId, input.code, input.prizeAmount);
      return result instanceof Response
        ? result
        : HttpResponse.json({
            data: { redeemLotteryTicket: { item: result } },
          });
    }),
    api.mutation("RevokeLotteryRedemption", ({ variables }) => {
      const { input } = variables as RevokeLotteryRedemptionMutationVariables;
      inputs.revoke.push(input);
      const result = revoke(input.id);
      return result instanceof Response
        ? result
        : HttpResponse.json({
            data: { revokeLotteryRedemption: { item: result } },
          });
    }),
    api.mutation("ReplaceLotteryRedemption", ({ variables }) => {
      const { input } = variables as ReplaceLotteryRedemptionMutationVariables;
      inputs.replace.push(input);
      const original = state.find((row) => row.id === input.id);
      const revoked = revoke(input.id);
      if (revoked instanceof Response || original === undefined) {
        return revoked instanceof Response
          ? revoked
          : graphqlError("FORBIDDEN", "NOT_FOUND", { code: "NOT_FOUND" });
      }
      const created = create(original.shift.id, input.code, input.prizeAmount);
      if (created instanceof Response) {
        return created;
      }
      created.replacesId = original.id;
      created.isPostClose = original.shift.closed;
      return HttpResponse.json({
        data: {
          replaceLotteryRedemption: { revoked, item: created },
        },
      });
    }),
    api.query("LotteryRecentRedemptions", ({ variables }) => {
      const { shiftId } = variables as LotteryRecentRedemptionsQueryVariables;
      return HttpResponse.json({
        data: {
          lotteryRecentRedemptions: state.filter(
            (row) =>
              row.shift.id === shiftId && row.redeemedBy.id === STORE_CLERK.id,
          ),
        },
      });
    }),
    api.query("LotteryRedemptions", ({ variables }) => {
      const { input } = variables as LotteryRedemptionsQueryVariables;
      const matched = state.filter(
        (row) =>
          (input.status == null || row.status === input.status) &&
          (input.cashPointId == null ||
            row.cashPoint.id === input.cashPointId) &&
          (input.redeemedBy == null || row.redeemedBy.id === input.redeemedBy),
      );
      const offset = input.offset ?? 0;
      return HttpResponse.json({
        data: {
          lotteryRedemptions: {
            __typename: "LotteryRedemptionsPayload",
            total: matched.length,
            items: matched.slice(offset, offset + (input.limit ?? 100)),
          },
        },
      });
    }),
    api.query("LotteryRedemption", ({ variables }) => {
      const { id } = variables as LotteryRedemptionQueryVariables;
      const row = state.find((item) => item.id === id);
      return row === undefined
        ? graphqlError("FORBIDDEN", "NOT_FOUND", { code: "NOT_FOUND" })
        : HttpResponse.json({ data: { lotteryRedemption: { item: row } } });
    }),
    api.query("LotteryPurchaseRedemptionRecords", ({ variables }) => {
      const { submissionId } =
        variables as LotteryPurchaseRedemptionRecordsQueryVariables;
      return HttpResponse.json({
        data: {
          lotteryPurchaseRedemptionRecords: state
            .filter((row) => row.purchase?.id === submissionId)
            .map((row) => ({ ...row, revokeMode: null })),
        },
      });
    }),
    api.query("LotteryPurchaseRedemptions", ({ variables }) => {
      const { submissionId } =
        variables as LotteryPurchaseRedemptionsQueryVariables;
      return HttpResponse.json({
        data: {
          lotteryPurchaseRedemptions: {
            items: state.filter(
              (row) =>
                row.status === "in_store" ||
                (submissionId != null && row.purchase?.id === submissionId),
            ),
          },
        },
      });
    }),
  ];
  return { handlers, inputs };
};
