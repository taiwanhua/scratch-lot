import { FormSubmissionStatus } from "@repo/graphql";
import type { LotteryTransferReceivingFieldsFragment } from "@repo/graphql";

import type { MockSubmission } from "../../form-fixtures";
import { masterDataOrgs } from "./master-data-fixtures";
import {
  TRANSFER_LOCKED_ABILITIES,
  transferReceivingRow,
  transferSubmission,
  transferTicketRange,
} from "./transfer-fixtures";

const { storeA, storeB } = masterDataOrgs;

const returnedLine = (
  rowId: string,
  bookNo: string,
  amount: number,
): Record<string, unknown> => ({
  rowId,
  game: { id: "game-5164", label: "發大財" },
  book: { id: `book-${rowId}`, label: `5164-${bookNo.slice(1)}` },
  mode: "whole",
  ticket_nos: "001-100",
  tickets: 100,
  amount,
  rate: 92,
});

/**
 * 被退回的調貨單(第二關點收時退回;編輯頁:已點收 / 已出貨在途的列鎖住):
 * t12-1 已點收、t12-2 已出貨在途、t12-3 還沒出貨。點收狀態見 `returnedTransferReceiving`。
 */
export const returnedTransfer = (): MockSubmission =>
  transferSubmission("doc-t12", "T-0012", storeA, storeB, 55_200, {
    status: FormSubmissionStatus.Returned,
    abilities: {
      ...TRANSFER_LOCKED_ABILITIES,
      canEdit: true,
      canSaveDraft: true,
    },
    values: {
      from_branch: { id: storeA.id, label: storeA.name },
      to_branch: { id: storeB.id, label: storeB.name },
      requisition: null,
      transfer_total: "55200",
      note: null,
      lines: [
        returnedLine("t12-1", "0056541", 20_000),
        returnedLine("t12-2", "0056542", 20_000),
        returnedLine("t12-3", "0056543", 20_000),
      ],
    },
  });

const returnedRow = (
  rowId: string,
  bookNo: string,
  state: "received" | "shipped" | "pending",
) =>
  transferReceivingRow(rowId, {
    bookNo,
    mode: "whole",
    ticketNos: transferTicketRange(1, 100),
    tickets: 100,
    amount: 20_000,
    purchaseAmount: 18_400,
    shipped: state !== "pending",
    shippedAt: state === "pending" ? null : "2026-10-16T01:10:00.000Z",
    received: state === "received",
    receivedAt: state === "received" ? "2026-10-16T07:20:00.000Z" : null,
  });

export const returnedTransferReceiving =
  (): LotteryTransferReceivingFieldsFragment => ({
    __typename: "LotteryTransferReceiving",
    submissionId: "doc-t12",
    fromBranchName: storeA.name,
    toBranchName: storeB.name,
    transferAmount: 55_200,
    canReceive: false,
    receivedCount: 1,
    totalCount: 3,
    rows: [
      returnedRow("t12-1", "0056541", "received"),
      returnedRow("t12-2", "0056542", "shipped"),
      returnedRow("t12-3", "0056543", "pending"),
    ],
    batches: [],
  });

/**
 * 少張處理(做法 A):T-0013 一列選張 #045–056(12 張 × 200 元、92%),收貨店只點收了 #045–053 就退回;
 * 出貨店在編輯頁取消勾選沒到的 #054–056。
 */
export const shortTransfer = (): MockSubmission =>
  transferSubmission("doc-t13", "T-0013", storeA, storeB, 2208, {
    status: FormSubmissionStatus.Returned,
    abilities: {
      ...TRANSFER_LOCKED_ABILITIES,
      canEdit: true,
      canSaveDraft: true,
    },
    values: {
      from_branch: { id: storeA.id, label: storeA.name },
      to_branch: { id: storeB.id, label: storeB.name },
      requisition: null,
      transfer_total: "2208",
      note: null,
      lines: [
        {
          rowId: "t13-1",
          game: { id: "game-5201", label: "金好運" },
          book: { id: "book-t13-1", label: "5201-060112" },
          mode: "partial",
          ticket_nos: "045-056",
          tickets: 12,
          amount: 2400,
          rate: 92,
        },
      ],
    },
  });

export const shortTransferReceiving =
  (): LotteryTransferReceivingFieldsFragment => ({
    __typename: "LotteryTransferReceiving",
    submissionId: "doc-t13",
    fromBranchName: storeA.name,
    toBranchName: storeB.name,
    transferAmount: 2208,
    canReceive: false,
    receivedCount: 0,
    totalCount: 1,
    rows: [
      transferReceivingRow("t13-1", {
        gameCode: "5201",
        gameName: "金好運",
        bookNo: "0060112",
        mode: "partial",
        ticketNos: transferTicketRange(45, 56),
        tickets: 12,
        amount: 2400,
        purchaseAmount: 2208,
        shipped: true,
        shippedAt: "2026-10-16T01:10:00.000Z",
        receivedTickets: 9,
        receivedTicketNos: transferTicketRange(45, 53),
      }),
    ],
    batches: [],
  });
