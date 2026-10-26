import { FormSubmissionStatus } from "@repo/graphql";
import type { LotteryPurchaseReceivingFieldsFragment } from "@repo/graphql";

import type { MockSubmission } from "../../form-fixtures";
import {
  purchaseReceiving,
  purchaseReceivingRow,
  purchaseSubmission,
} from "./purchase-fixtures";

const PURCHASE_BRANCH = { id: "org-store" };

const PURCHASE_LOCKED_ABILITIES = {
  canEdit: false,
  canSaveDraft: false,
  canDelete: false,
  canEditField: [],
  canWithdraw: false,
  canVoid: false,
  canCopy: false,
};

/**
 * 被退回的進貨單(編輯頁:帶入原內容、已點收的列鎖住;規格 8.2「打錯 → 退回修改沒點收的列」):
 * 5164 兩本(row-1 已點收、row-5 沒點收),引用叫貨單 R-0042、勾了兌獎紀錄 rd-031。點收狀態配 `returnedPurchaseReceiving`。
 */
export const returnedPurchase = (): MockSubmission =>
  purchaseSubmission("doc-p35", "P-0035", "林大同 #87654321", 36_800, {
    status: FormSubmissionStatus.Returned,
    abilities: {
      ...PURCHASE_LOCKED_ABILITIES,
      canEdit: true,
      canSaveDraft: true,
    },
    values: {
      branch: PURCHASE_BRANCH.id,
      requisition: "R-0042",
      dealer: { id: "dealer-a", label: "林大同 #87654321" },
      self_purchase: true,
      trustee: null,
      purchase_date: "2026-10-12T16:00:00.000Z",
      account: { id: "acc-1", label: "台灣銀行 ****12345" },
      note: "第一批",
      lines: [
        {
          rowId: "row-1",
          game: { id: "game-5164", label: "發大財" },
          book_no: "0056527",
          last_ticket_no: 99,
          tickets: 100,
          book_price: 20_000,
          rate: 92,
        },
        {
          rowId: "row-5",
          game: { id: "game-5164", label: "發大財" },
          book_no: "0056531",
          last_ticket_no: 99,
          tickets: 100,
          book_price: 20_000,
          rate: 92,
        },
      ],
      redemptions: [
        {
          rowId: "rd-row-1",
          redemption: { id: "rd-031", label: "5164-056527-031" },
          prize_amount: 500,
        },
      ],
    },
  });

/** `returnedPurchase` 的點收狀態:row-1 已點收、row-5 沒點收;單據已退回,不能點收。 */
export const returnedPurchaseReceiving =
  (): LotteryPurchaseReceivingFieldsFragment => ({
    ...purchaseReceiving("doc-p35"),
    canReceive: false,
    receivedCount: 1,
    totalCount: 2,
    groups: [
      {
        __typename: "LotteryPurchaseReceivingGroup",
        gameId: "game-5164",
        gameCode: "5164",
        gameName: "發大財",
        unitPrice: 200,
        requestedBooks: null,
        receivedBooks: 1,
        subtotal: 36_800,
        rows: [
          purchaseReceivingRow("row-1", "0056527", 99, 20_000, true),
          purchaseReceivingRow("row-5", "0056531", 99, 20_000, false),
        ],
      },
    ],
  });
