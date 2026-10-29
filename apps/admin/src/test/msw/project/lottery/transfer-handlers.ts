import { HttpResponse } from "msw";

import type {
  CompleteLotteryTransferReceivingMutationVariables,
  LotterySettlementQueryVariables,
  LotteryTransferProgressQueryVariables,
  LotteryTransferReceivingFieldsFragment,
  LotteryTransferReceivingQueryVariables,
  NotifyLotteryTransferWrongStoreMutationVariables,
  ReceiveLotteryTransferBookMutationVariables,
  ReceiveLotteryTransferTicketsMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api, type server } from "../../server";
import { sampleOutstanding, settlementOf } from "./accounts-fixtures";
import {
  NO_RECEIPT_LINK_ROUTES,
  receiptLinksPayload,
} from "./receipt-links-handlers";
import { transferReceiving } from "./transfer-fixtures";
import {
  transferBookTickets,
  transferOptions,
} from "./transfer-option-fixtures";
import { transferSettlement } from "./transfer-settlement-fixtures";

/**
 * 調貨單的假 api(規則照 `docs/modules/project/purchasing.md`「調貨單」):新增頁選項、張數格子、
 * 檢視頁的出貨確認清單 / 點收區塊、刷條碼點收(單上沒點收的那一列 → 點收;`TRANSFER_WRONG_STORE_CODE` →
 * 送錯分店;其他 → 不在單上)、[完成這次點收](這一次已點收、還沒有批次的列 → 新的點收批次 `tbatch-N`)、
 * 列表的進度與結算、調貨單的收付(其他單據的收付交給帳戶管理的 world)。
 * 調貨單本身走表單執行端的 world(`transferFormWorld`)。
 */
export const TRANSFER_WRONG_STORE_CODE = "5164-1-077777-010-0-6";

export interface TransferWorld {
  handlers: Parameters<typeof server.use>;
  /** 刷過的碼 */
  scanned: string[];
  /** 按過 [通知總部更正] 的碼 */
  notified: string[];
}

const PROGRESS = new Map([
  [
    "sub-t9",
    {
      wholeBooks: 1,
      partialTickets: 0,
      receivedCount: 0,
      totalCount: 1,
      inTransit: false,
      settlementKind: null,
      settlementAmount: 0,
      inSettlement: false,
    },
  ],
  [
    "doc-t8",
    {
      wholeBooks: 0,
      partialTickets: 10,
      receivedCount: 0,
      totalCount: 1,
      inTransit: false,
      settlementKind: "to_receive",
      settlementAmount: 1840,
      inSettlement: true,
    },
  ],
  [
    "doc-t10",
    {
      wholeBooks: 1,
      partialTickets: 12,
      receivedCount: 1,
      totalCount: 2,
      inTransit: true,
      settlementKind: "to_receive",
      settlementAmount: 19_504,
      inSettlement: true,
    },
  ],
  [
    "sub-t7",
    {
      wholeBooks: 2,
      partialTickets: 0,
      receivedCount: 2,
      totalCount: 2,
      inTransit: false,
      settlementKind: null,
      settlementAmount: 0,
      inSettlement: true,
    },
  ],
]);

const wrongStore = () =>
  graphqlError(
    "VALIDATION_FAILED",
    "Book belongs to another store's transfer",
    {
      reason: "TRANSFER_WRONG_STORE",
      ownerBranchName: "台中店",
      serialNo: "T-0011",
      gameName: "發大財",
      unitPrice: 200,
      bookNo: "077777",
    },
  );

export interface TransferWorldOptions {
  /**
   * 收付端點(`LotterySettlement`)怎麼回:`own`(預設)= 只回調貨單自己的(兩邊),其他單據落到帳戶管理的 world;
   * `all` = 這裡一個 handler 回全部(調貨單用自己的,其他單據照帳戶管理夾具的待結清列;mock 開發模式一個操作
   * 只能有一個 handler,帳戶管理那一個要拿掉,見 `withoutSettlementHandler`)。
   */
  settlement?: "own" | "all";
  /** [完成這次點收] 帶回的 QR 路由:`none` = 模組停用 / 沒有 route(都是 null);預設有路由 */
  receiptRoutes?: "default" | "none";
}

/** 調貨單自己的收付(兩邊);其他單據:`all` 照帳戶管理夾具,`own` 不回(落到下一個 handler)。 */
const settlementHandler = (mode: "own" | "all") =>
  api.query("LotterySettlement", ({ variables }) => {
    const { refId } = variables as LotterySettlementQueryVariables;
    const item = transferSettlement(refId);
    if (item !== null) {
      return HttpResponse.json({ data: { lotterySettlement: { item } } });
    }
    if (mode === "own") {
      // 不回 = 落到下一個 handler(帳戶管理的 world)
      return;
    }
    const row = sampleOutstanding().find((one) => one.refId === refId);
    return row === undefined
      ? graphqlError("NOT_FOUND")
      : HttpResponse.json({
          data: { lotterySettlement: { item: settlementOf(row) } },
        });
  });

/** 拿掉一組 handler 裡的收付端點(mock 開發模式改由 `transferWorld({ settlement: "all" })` 回)。 */
export const withoutSettlementHandler = (
  handlers: Parameters<typeof server.use>,
): Parameters<typeof server.use> =>
  handlers.filter((handler) => {
    const info: unknown = "info" in handler ? handler.info : null;
    return !(
      typeof info === "object" &&
      info !== null &&
      "operationName" in info &&
      info.operationName === "LotterySettlement"
    );
  });

export const transferWorld = ({
  settlement = "own",
  receiptRoutes = "default",
}: TransferWorldOptions = {}): TransferWorld => {
  const scanned: string[] = [];
  const notified: string[] = [];
  const receivings = new Map<string, LotteryTransferReceivingFieldsFragment>();
  const receivingOf = (id: string) =>
    receivings.get(id) ?? transferReceiving(id);
  /** 點收這一列的幾張(mock;整本的列整列)。已點收的張 → 已點收。 */
  const receiveRow = (
    submissionId: string,
    rowId: string,
    ticketNos: readonly string[],
  ) => {
    const current = receivingOf(submissionId);
    const target = current.rows.find((row) => row.rowId === rowId);
    if (target === undefined) {
      return graphqlError("VALIDATION_FAILED", "Not on this transfer", {
        reason: "TRANSFER_BOOK_NOT_ON_TRANSFER",
      });
    }
    const already = ticketNos.filter((no) =>
      target.receivedTicketNos.includes(no),
    );
    if (already.length > 0 || target.received) {
      return graphqlError("VALIDATION_FAILED", "Already received", {
        reason: "TRANSFER_ALREADY_RECEIVED",
        ticketNos: already,
      });
    }
    const receivedTicketNos = [
      ...new Set([...target.receivedTicketNos, ...ticketNos]),
    ].toSorted((a, b) => a.localeCompare(b, "zh-Hant"));
    const isFull = receivedTicketNos.length >= target.tickets;
    const next = {
      ...current,
      receivedCount: current.receivedCount + (isFull ? 1 : 0),
      rows: current.rows.map((row) =>
        row.rowId === rowId
          ? {
              ...row,
              received: isFull,
              receivedTickets: receivedTicketNos.length,
              receivedTicketNos,
              batchId: null,
            }
          : row,
      ),
    };
    receivings.set(submissionId, next);
    return HttpResponse.json<{ data: Record<string, unknown> }>({
      data: {
        receiveLotteryTransferBook: {
          __typename: "ReceiveLotteryTransferBookPayload",
          rowId,
          ticketNos: [...ticketNos],
          receiving: next,
        },
        receiveLotteryTransferTickets: {
          __typename: "ReceiveLotteryTransferBookPayload",
          rowId,
          ticketNos: [...ticketNos],
          receiving: next,
        },
      },
    });
  };

  return {
    scanned,
    notified,
    handlers: [
      api.mutation("NotifyLotteryTransferWrongStore", ({ variables }) => {
        const { input } =
          variables as NotifyLotteryTransferWrongStoreMutationVariables;
        notified.push(input.code);
        return HttpResponse.json({
          data: { notifyLotteryTransferWrongStore: true },
        });
      }),
      api.query("LotteryTransferOptions", () =>
        HttpResponse.json({
          data: { lotteryTransferOptions: transferOptions() },
        }),
      ),
      api.query("LotteryTransferBookTickets", () =>
        HttpResponse.json({
          data: { lotteryTransferBookTickets: transferBookTickets() },
        }),
      ),
      api.query("LotteryTransferReceiving", ({ variables }) => {
        const { submissionId } =
          variables as LotteryTransferReceivingQueryVariables;
        return HttpResponse.json({
          data: { lotteryTransferReceiving: receivingOf(submissionId) },
        });
      }),
      api.mutation("ReceiveLotteryTransferBook", ({ variables }) => {
        const { input } =
          variables as ReceiveLotteryTransferBookMutationVariables;
        scanned.push(input.code);
        if (input.code === TRANSFER_WRONG_STORE_CODE) {
          return wrongStore();
        }
        const current = receivingOf(input.submissionId);
        const pending = current.rows.find(
          (row) => !row.received && input.code.includes(row.bookNo.slice(1)),
        );
        if (pending === undefined) {
          return graphqlError(
            "VALIDATION_FAILED",
            "Book is not on this transfer",
            { reason: "TRANSFER_BOOK_NOT_ON_TRANSFER" },
          );
        }
        // 整本的列刷一張 = 整列;選張的列只點收刷到的那一張(正面碼最後 3 碼 = 張號)
        const ticketNos =
          pending.mode === "whole" ? pending.ticketNos : [input.code.slice(-3)];
        return receiveRow(input.submissionId, pending.rowId, ticketNos);
      }),
      api.mutation("ReceiveLotteryTransferTickets", ({ variables }) => {
        const { input } =
          variables as ReceiveLotteryTransferTicketsMutationVariables;
        const ticketNos = Array.isArray(input.ticketNos)
          ? input.ticketNos
          : [input.ticketNos];
        return receiveRow(input.submissionId, input.rowId, ticketNos);
      }),
      api.mutation("CompleteLotteryTransferReceiving", ({ variables }) => {
        const { input } =
          variables as CompleteLotteryTransferReceivingMutationVariables;
        const wanted = new Set(
          Array.isArray(input.rowIds) ? input.rowIds : [input.rowIds],
        );
        const current = receivingOf(input.submissionId);
        const rowIds = current.rows
          .filter(
            (row) =>
              row.receivedTickets > 0 &&
              row.batchId == null &&
              wanted.has(row.rowId),
          )
          .map((row) => row.rowId);
        const batch =
          rowIds.length === 0
            ? null
            : {
                __typename: "LotteryTransferReceivingBatch" as const,
                batchId: `tbatch-${String(current.batches.length + 1)}`,
                no: current.batches.length + 1,
                completedAt: new Date().toISOString(),
                rowIds,
                rows: rowIds.map((rowId) => ({
                  __typename: "LotteryTransferReceivingBatchRow" as const,
                  rowId,
                  ticketNos:
                    current.rows.find((row) => row.rowId === rowId)
                      ?.receivedTicketNos ?? [],
                })),
              };
        const next =
          batch === null
            ? current
            : {
                ...current,
                batches: [...current.batches, batch],
                rows: current.rows.map((row) =>
                  rowIds.includes(row.rowId)
                    ? { ...row, batchId: batch.batchId }
                    : row,
                ),
              };
        receivings.set(input.submissionId, next);
        return HttpResponse.json({
          data: {
            completeLotteryTransferReceiving: {
              batch,
              receiving: next,
              receiptLinks:
                receiptRoutes === "none"
                  ? receiptLinksPayload(NO_RECEIPT_LINK_ROUTES)
                  : receiptLinksPayload(),
            },
          },
        });
      }),
      api.query("LotteryTransferProgress", ({ variables }) => {
        const { transferIds } =
          variables as LotteryTransferProgressQueryVariables;
        const ids = Array.isArray(transferIds) ? transferIds : [transferIds];
        return HttpResponse.json({
          data: {
            lotteryTransferProgress: ids.flatMap((id) => {
              const item = PROGRESS.get(id);
              return item === undefined
                ? []
                : [
                    {
                      __typename: "LotteryTransferProgress",
                      transferId: id,
                      ...item,
                    },
                  ];
            }),
          },
        });
      }),
      settlementHandler(settlement),
    ],
  };
};
