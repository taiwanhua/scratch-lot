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
