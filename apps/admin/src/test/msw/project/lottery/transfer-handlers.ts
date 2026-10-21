import { HttpResponse } from "msw";

import type {
  LotterySettlementQueryVariables,
  LotteryTransferProgressQueryVariables,
  LotteryTransferReceivingFieldsFragment,
  LotteryTransferReceivingQueryVariables,
  ReceiveLotteryTransferBookMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api, type server } from "../../server";
import {
  transferBookTickets,
  transferOptions,
  transferReceiving,
} from "./transfer-fixtures";
import { transferSettlement } from "./transfer-settlement-fixtures";

/**
 * 調貨單的假 api(規則照 `docs/modules/project/purchasing.md`「調貨單」):新增頁選項、張數格子、
 * 檢視頁的出貨確認清單 / 點收區塊、刷條碼點收(單上沒點收的那一列 → 點收;`TRANSFER_WRONG_STORE_CODE` →
 * 送錯分店;其他 → 不在單上)、列表的進度與結算、調貨單的收付(其他單據的收付交給帳戶管理的 world)。
 * 調貨單本身走表單執行端的 world(`transferFormWorld`)。
 */
export const TRANSFER_WRONG_STORE_CODE = "5164-1-077777-010-0-6";

export interface TransferWorld {
  handlers: Parameters<typeof server.use>;
  /** 刷過的碼 */
  scanned: string[];
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
   * 回調貨單自己的收付(兩邊;其他單據不回,交給帳戶管理的 world)。mock 開發模式一個操作只能有一個
   * handler,關掉後收付全交給帳戶管理的 world(T-0008 照帳戶管理夾具的待收那一列)。
   */
  withSettlement?: boolean;
}

/** 調貨單自己的收付(兩邊);其他單據不回(落到下一個 handler)。 */
const settlementHandler = api.query("LotterySettlement", ({ variables }) => {
  const { refId } = variables as LotterySettlementQueryVariables;
  const item = transferSettlement(refId);
  return item === null
    ? undefined
    : HttpResponse.json({ data: { lotterySettlement: { item } } });
});

export const transferWorld = ({
  withSettlement = true,
}: TransferWorldOptions = {}): TransferWorld => {
  const scanned: string[] = [];
  const receivings = new Map<string, LotteryTransferReceivingFieldsFragment>();
  const receivingOf = (id: string) =>
    receivings.get(id) ?? transferReceiving(id);
  return {
    scanned,
    handlers: [
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
        const next = {
          ...current,
          receivedCount: current.receivedCount + 1,
          rows: current.rows.map((row) =>
            row.rowId === pending.rowId ? { ...row, received: true } : row,
          ),
        };
        receivings.set(input.submissionId, next);
        return HttpResponse.json({
          data: {
            receiveLotteryTransferBook: {
              __typename: "ReceiveLotteryTransferBookPayload",
              rowId: pending.rowId,
              receiving: next,
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
      ...(withSettlement ? [settlementHandler] : []),
    ],
  };
};
