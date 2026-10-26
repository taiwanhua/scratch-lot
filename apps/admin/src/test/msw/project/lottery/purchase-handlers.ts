import { HttpResponse } from "msw";

import type {
  CompleteLotteryPurchaseReceivingMutationVariables,
  LotteryDealerPurchasesQuery,
  LotteryPurchaseProgressQueryVariables,
  LotteryPurchaseReceivingFieldsFragment,
  ReceiveLotteryPurchaseBookMutationVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api, type server } from "../../server";
import { purchaseOptions, purchaseReceiving } from "./purchase-fixtures";

/**
 * 進貨單的假 api(規則照 `docs/modules/project/purchasing.md`「進貨單」):新增頁選項、點收區塊、
 * 刷條碼點收(單上沒點收的那一本 → 點收;`WRONG_STORE_CODE` → 送錯分店;其他 → 不在單上)、
 * [完成這次點收](這一次已點收、還沒有批次的列 → 新的點收批次 `batch-N`)、
 * [通知總部更正]、列表的點收進度與結算、甲類的批購紀錄。進貨單本身走表單執行端的 world(`purchaseFormWorld`)。
 */
export const WRONG_STORE_CODE = "5201-1-060116-100-0-6";

export interface PurchaseWorld {
  handlers: Parameters<typeof server.use>;
  /** 刷過的碼 */
  scanned: string[];
  /** 按過 [通知總部更正] 的碼 */
  notified: string[];
  /** 刷 `AMBIGUOUS_FRONT_CODE` 時帶的遊戲(null = 沒選) */
  pickedGameIds: (string | null)[];
}

const PROGRESS = new Map<
  string,
  {
    receivedCount: number;
    totalCount: number;
    settlementKind: string | null;
    settlementAmount: number;
    inSettlement: boolean;
  }
>([
  [
    "sub-p34",
    {
      receivedCount: 0,
      totalCount: 0,
      settlementKind: null,
      settlementAmount: 0,
      inSettlement: false,
    },
  ],
  [
    "doc-p33",
    {
      receivedCount: 5,
      totalCount: 6,
      settlementKind: null,
      settlementAmount: 0,
      inSettlement: true,
    },
  ],
  [
    "doc-p31",
    {
      receivedCount: 10,
      totalCount: 10,
      settlementKind: "to_refund",
      settlementAmount: 2000,
      inSettlement: true,
    },
  ],
  [
    "sub-p30",
    {
      receivedCount: 10,
      totalCount: 10,
      settlementKind: null,
      settlementAmount: 0,
      inSettlement: true,
    },
  ],
]);

const dealerPurchases =
  (): LotteryDealerPurchasesQuery["lotteryDealerPurchases"] => [
    {
      __typename: "LotteryDealerPurchase",
      purchaseId: "doc-p33",
      serialNo: "P-0033",
      branchName: "中山店",
      purchaseDate: "2026-10-12T16:00:00.000Z",
      selfPurchase: false,
      trusteeName: "林受託",
      books: 6,
      purchaseTotal: 101_568,
      status: "reviewing",
    },
    {
      __typename: "LotteryDealerPurchase",
      purchaseId: "sub-p30",
      serialNo: "P-0030",
      branchName: "新竹店",
      purchaseDate: "2026-10-02T16:00:00.000Z",
      selfPurchase: true,
      trusteeName: null,
      books: 2,
      purchaseTotal: 36_800,
      status: "completed",
    },
  ];

const wrongStore = () =>
  graphqlError(
    "VALIDATION_FAILED",
    "Book belongs to another store's purchase",
    {
      reason: "PURCHASE_WRONG_STORE",
      ownerBranchName: "新竹店",
      serialNo: "P-0033",
      gameName: "金好運",
      unitPrice: 100,
      bookNo: "060116",
    },
  );

/** 正面條碼:對到單上兩款遊戲同本號(這個假 api 當成要選遊戲;選了配 row-5)。 */
export const AMBIGUOUS_FRONT_CODE = "0056531098";

export interface PurchaseWorldOptions {
  /** 點收區塊的起始資料(預設 Figma PU-06 那一筆) */
  receiving?: LotteryPurchaseReceivingFieldsFragment;
}

export const purchaseWorld = ({
  receiving: initial = purchaseReceiving(),
}: PurchaseWorldOptions = {}): PurchaseWorld => {
  const scanned: string[] = [];
  const pickedGameIds: (string | null)[] = [];
  const notified: string[] = [];
  let receiving: LotteryPurchaseReceivingFieldsFragment = initial;
  return {
    scanned,
    notified,
    pickedGameIds,
    handlers: [
      api.query("LotteryPurchaseOptions", () =>
        HttpResponse.json({
          data: { lotteryPurchaseOptions: purchaseOptions() },
        }),
      ),
      api.query("LotteryPurchaseReceiving", () =>
        HttpResponse.json({ data: { lotteryPurchaseReceiving: receiving } }),
      ),
      api.mutation("ReceiveLotteryPurchaseBook", ({ variables }) => {
        const { input } =
          variables as ReceiveLotteryPurchaseBookMutationVariables;
        scanned.push(input.code);
        if (input.code === WRONG_STORE_CODE) {
          return wrongStore();
        }
        // 正面條碼對到單上兩款遊戲同本號:沒選遊戲 → 擋下;選了 → 照所選的遊戲(這裡配 row-5)
        if (input.code === AMBIGUOUS_FRONT_CODE) {
          pickedGameIds.push(input.gameId ?? null);
          if (input.gameId === null || input.gameId === undefined) {
            return graphqlError(
              "VALIDATION_FAILED",
              "Several games share the book number",
              {
                reason: "PURCHASE_SCAN_AMBIGUOUS_GAME",
                gameIds: ["game-5164", "game-5201"],
              },
            );
          }
        }
        const pending = receiving.groups
          .flatMap((group) => group.rows)
          .find(
            (row) => !row.received && input.code.includes(row.bookNo.slice(1)),
          );
        if (pending === undefined) {
          return graphqlError(
            "VALIDATION_FAILED",
            "Book is not on this purchase",
            {
              reason: "PURCHASE_BOOK_NOT_ON_PURCHASE",
            },
          );
        }
        receiving = {
          ...receiving,
          receivedCount: receiving.receivedCount + 1,
          groups: receiving.groups.map((group) => ({
            ...group,
            receivedBooks:
              group.receivedBooks +
              (group.rows.some((row) => row.rowId === pending.rowId) ? 1 : 0),
            rows: group.rows.map((row) =>
              row.rowId === pending.rowId ? { ...row, received: true } : row,
            ),
          })),
        };
        return HttpResponse.json({
          data: {
            receiveLotteryPurchaseBook: {
              __typename: "ReceiveLotteryPurchaseBookPayload",
              rowId: pending.rowId,
              receiving,
            },
          },
        });
      }),
      api.mutation("CompleteLotteryPurchaseReceiving", ({ variables }) => {
        const { input } =
          variables as CompleteLotteryPurchaseReceivingMutationVariables;
        const wanted = new Set(
          Array.isArray(input.rowIds) ? input.rowIds : [input.rowIds],
        );
        const rowIds = receiving.groups
          .flatMap((group) => group.rows)
          .filter(
            (row) =>
              row.received && row.batchId === null && wanted.has(row.rowId),
          )
          .map((row) => row.rowId);
        const batch =
          rowIds.length === 0
            ? null
            : {
                __typename: "LotteryPurchaseReceivingBatch" as const,
                batchId: `batch-${String(receiving.batches.length + 1)}`,
                no: receiving.batches.length + 1,
                completedAt: new Date().toISOString(),
                rowIds,
              };
        if (batch !== null) {
          receiving = {
            ...receiving,
            batches: [...receiving.batches, batch],
            groups: receiving.groups.map((group) => ({
              ...group,
              rows: group.rows.map((row) =>
                rowIds.includes(row.rowId)
                  ? { ...row, batchId: batch.batchId }
                  : row,
              ),
            })),
          };
        }
        return HttpResponse.json({
          data: { completeLotteryPurchaseReceiving: { batch, receiving } },
        });
      }),
      api.mutation("NotifyLotteryPurchaseWrongStore", ({ variables }) => {
        const { input } =
          variables as ReceiveLotteryPurchaseBookMutationVariables;
        notified.push(input.code);
        return HttpResponse.json({
          data: { notifyLotteryPurchaseWrongStore: true },
        });
      }),
      api.query("LotteryPurchaseProgress", ({ variables }) => {
        const { purchaseIds } =
          variables as LotteryPurchaseProgressQueryVariables;
        const ids = Array.isArray(purchaseIds) ? purchaseIds : [purchaseIds];
        return HttpResponse.json({
          data: {
            lotteryPurchaseProgress: ids.flatMap((id) => {
              const item = PROGRESS.get(id);
              return item === undefined
                ? []
                : [
                    {
                      __typename: "LotteryPurchaseProgress",
                      purchaseId: id,
                      ...item,
                    },
                  ];
            }),
          },
        });
      }),
      api.query("LotteryDealerPurchases", () =>
        HttpResponse.json({
          data: { lotteryDealerPurchases: dealerPurchases() },
        }),
      ),
    ],
  };
};
