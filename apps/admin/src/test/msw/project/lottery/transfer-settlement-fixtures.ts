import type { LotterySettlementFieldsFragment } from "@repo/graphql";

import { masterDataOrgs } from "./master-data-fixtures";
import { TRANSFER_MODULE_KEY } from "./transfer-fixtures";

/** 調貨單收付的夾具(兩邊;規格第 9 章、Figma PU-10b)。 */
const { storeA, storeB } = masterDataOrgs;

const side = (
  key: "receiver" | "shipper",
  totals: { out: number; in: number },
  defaults: { out: number; in: number },
  canSettle: boolean,
): LotterySettlementFieldsFragment["sides"][number] => {
  const isReceiver = key === "receiver";
  return {
    __typename: "LotterySettlementSide",
    side: key,
    label: isReceiver ? "收貨店" : "出貨店",
    role: isReceiver ? "payer" : "payee",
    methods: isReceiver ? ["bank", "cash"] : ["bank"],
    branch: {
      __typename: "LotteryAccountsRef",
      id: isReceiver ? storeA.id : storeB.id,
      name: isReceiver ? storeA.name : storeB.name,
    },
    totalOut: totals.out,
    totalIn: totals.in,
    net: isReceiver ? totals.out - totals.in : totals.in - totals.out,
    canSettle,
    // 收貨店有一個開著班的收銀點(用現金時可以選它的抽屜)
    cashDrawers: isReceiver
      ? [
          {
            __typename: "LotteryAccountsRef",
            id: "cp-counter",
            name: "店內櫃台",
          },
        ]
      : [],
    buttons: (["out", "in"] as const).map((button) => ({
      __typename: "LotterySettlementButton" as const,
      button,
      defaultAmount: defaults[button],
      canUse: canSettle && defaults[button] > 0,
    })),
  };
};

/**
 * T-0010 的結算(PU-10b):調貨金額 19,504,收貨店(中山店)付現 19,504,出貨店還沒登記收款 →
 * 「19,504 待出貨店入帳」;中山店只能記收貨店那一邊。
 */
export const transferSettlement = (
  refId: string,
): LotterySettlementFieldsFragment | null =>
  refId === "doc-t10"
    ? {
        __typename: "LotterySettlement",
        moduleKey: TRANSFER_MODULE_KEY,
        label: "調貨單",
        kind: "transfer",
        refId,
        docNo: "T-0010",
        counterparty: "新竹店 → 中山店",
        payable: 19_504,
        pendingPayee: 19_504,
        sides: [
          side(
            "receiver",
            { out: 19_504, in: 0 },
            { out: 0, in: 18_400 },
            true,
          ),
          side("shipper", { out: 0, in: 0 }, { out: 0, in: 19_504 }, false),
        ],
        records: [
          {
            __typename: "LotterySettlementRecord",
            id: "cash-t10",
            method: "cash",
            side: "receiver",
            type: "transfer_out",
            direction: "out",
            amount: 19_504,
            accountLabel: null,
            cashPlace: "vault",
            cashPointName: null,
            cashPointPrinterId: null,
            handler: "王小明(送貨人)",
            note: null,
            occurredAt: "2026-10-16T07:20:00.000Z",
            createdBy: {
              __typename: "LotteryAccountsRef",
              id: "user-lee",
              name: "李小華",
            },
            reversalOf: null,
            reversedById: null,
            canReverse: true,
          },
        ],
      }
    : null;
