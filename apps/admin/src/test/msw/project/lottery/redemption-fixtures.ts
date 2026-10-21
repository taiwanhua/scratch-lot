import { displayTicketKey } from "@repo/domain/project/lottery";
import type { LotteryRedemptionFieldsFragment } from "@repo/graphql";

import { STORE_CLERK } from "./store-fixtures";

/**
 * 兌獎(規格 6.5;Figma ST-38b / ST-39 / ST-40)的夾具:中山店的兌獎紀錄 —— 王小明在店內櫃台開著的班
 * (`shift-counter`,看板夾具同一班)登記的三筆(一筆已撤銷),與已交班的兩筆已送兌(進貨單 P-0034)。
 * 元件測試、假 api 與 mock 模式共用。
 */

export type RedemptionFixture = LotteryRedemptionFieldsFragment;

const ref = (id: string, name: string) => ({
  __typename: "LotteryAccountsRef" as const,
  id,
  name,
});

const GAMES: Record<string, string> = {
  "5164": "發大財",
  "5201": "金好運",
  "5198": "鼠來寶",
  "5150": "好運旺旺",
};

export interface RedemptionInput {
  id: string;
  gameCode: string;
  bookNo: string;
  ticketNo: string;
  prizeAmount: number;
  redeemedAt: string;
  status?: string;
  cashPoint?: { id: string; name: string };
  shift?: { id: string; name: string; openedAt: string; closed: boolean };
  redeemedBy?: { id: string; name: string };
  purchase?: { id: string; serialNo: string } | null;
  revokeMode?: string | null;
  isOwnStore?: boolean;
}

/** 沒指定時:已撤銷沒有按鈕,其他是自己撤銷。 */
const revokeModeOf = (
  input: RedemptionInput,
  status: string,
): string | null => {
  if (input.revokeMode !== undefined) {
    return input.revokeMode;
  }
  return status === "revoked" ? null : "self";
};

export const redemptionRow = (input: RedemptionInput): RedemptionFixture => {
  const status = input.status ?? "in_store";
  const shift = input.shift ?? {
    id: "shift-counter",
    name: STORE_CLERK.name,
    openedAt: "2026-10-16T00:02:00.000Z",
    closed: false,
  };
  const cashPoint = input.cashPoint ?? { id: "cp-counter", name: "店內櫃台" };
  const redeemedBy = input.redeemedBy ?? STORE_CLERK;
  return {
    __typename: "LotteryRedemption",
    id: input.id,
    orgId: "org-store-a",
    gameCode: input.gameCode,
    gameName: GAMES[input.gameCode] ?? null,
    bookNo: input.bookNo,
    ticketNo: input.ticketNo,
    ticketLabel: displayTicketKey(input.gameCode, input.bookNo, input.ticketNo),
    isOwnStore: input.isOwnStore ?? true,
    prizeAmount: input.prizeAmount,
    status,
    cashPoint: ref(cashPoint.id, cashPoint.name),
    shift: {
      __typename: "LotteryRedemptionShift",
      id: shift.id,
      openedBy: ref("user-wang", shift.name),
      openedAt: shift.openedAt,
      closed: shift.closed,
    },
    redeemedAt: input.redeemedAt,
    redeemedBy: ref(redeemedBy.id, redeemedBy.name),
    purchase:
      input.purchase == null
        ? null
        : {
            __typename: "LotteryRedemptionPurchase",
            id: input.purchase.id,
            serialNo: input.purchase.serialNo,
          },
    sentAt: status === "sent" ? input.redeemedAt : null,
    revokedAt: status === "revoked" ? input.redeemedAt : null,
    revokedBy:
      status === "revoked" ? ref(redeemedBy.id, redeemedBy.name) : null,
    revokeReason: null,
    revokeReasonKey: status === "revoked" ? "immediate" : null,
    revokeNote: null,
    replacesId: null,
    isPostClose: false,
    note: null,
    revokeMode: revokeModeOf(input, status),
    revokeBlockedBySent: status === "sent",
  };
};

// 進貨單假 api 的 `doc-p33`(檢視頁讀得到勾選的兌獎紀錄)
const PURCHASE = { id: "doc-p33", serialNo: "P-0033" };
const CLOSED_SHIFT = {
  id: "shift-old",
  name: "陳美玲",
  openedAt: "2026-10-15T05:00:00.000Z",
  closed: true,
};

/** Figma ST-38b / ST-40 的兌獎紀錄(新到舊)。 */
export const sampleRedemptions = (): RedemptionFixture[] => [
  redemptionRow({
    id: "rd-031",
    gameCode: "5164",
    bookNo: "0056527",
    ticketNo: "031",
    prizeAmount: 500,
    redeemedAt: "2026-10-16T13:50:00.000Z",
  }),
  redemptionRow({
    id: "rd-044",
    gameCode: "5201",
    bookNo: "0060112",
    ticketNo: "044",
    prizeAmount: 200,
    redeemedAt: "2026-10-16T13:31:00.000Z",
    status: "revoked",
  }),
  redemptionRow({
    id: "rd-017",
    gameCode: "5198",
    bookNo: "0088102",
    ticketNo: "017",
    prizeAmount: 100,
    redeemedAt: "2026-10-16T13:05:00.000Z",
  }),
  redemptionRow({
    id: "rd-083",
    gameCode: "5150",
    bookNo: "0042210",
    ticketNo: "083",
    prizeAmount: 1000,
    redeemedAt: "2026-10-15T10:40:00.000Z",
    status: "sent",
    cashPoint: { id: "cp-outdoor", name: "店外攤位" },
    shift: CLOSED_SHIFT,
    redeemedBy: { id: "user-chen", name: "陳美玲" },
    purchase: PURCHASE,
    revokeMode: "manager",
  }),
  redemptionRow({
    id: "rd-012",
    gameCode: "5164",
    bookNo: "0056527",
    ticketNo: "012",
    prizeAmount: 1000,
    redeemedAt: "2026-10-15T11:20:00.000Z",
    cashPoint: { id: "cp-outdoor", name: "店外攤位" },
    shift: CLOSED_SHIFT,
    redeemedBy: { id: "user-chen", name: "陳美玲" },
    revokeMode: "manager",
  }),
];
