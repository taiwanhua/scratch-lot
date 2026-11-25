import type { LotterySettlementFieldsFragment } from "@repo/graphql";

import { masterDataOrgs } from "./master-data-fixtures";
import { WHOLESALE_MODULE_KEY } from "./wholesale-fixtures";

const { storeA } = masterDataOrgs;

/** W-0001 的結算(Figma WS-03a):批售金額 37,200、已收 20,000(現金・小金庫)。其他單不參與收付。 */
export const wholesaleSettlement = (
  refId: string,
  received = 20_000,
): LotterySettlementFieldsFragment | null =>
  refId === "doc-w1"
    ? {
        __typename: "LotterySettlement",
        moduleKey: WHOLESALE_MODULE_KEY,
        label: "批售單",
        kind: "wholesale",
        refId,
        docNo: "W-0001",
        counterparty: "好運彩券行",
        payable: 37_200,
        pendingPayee: 0,
        sides: [
          {
            __typename: "LotterySettlementSide",
            side: "shipper",
            label: "出貨店",
            role: "payee",
            methods: ["bank", "cash"],
            branch: { __typename: "LotteryAccountsRef", ...storeA },
            totalOut: 0,
            totalIn: received,
            net: received,
            canSettle: true,
            cashDrawers: [],
            buttons: (["out", "in"] as const).map((button) => {
              const defaultAmount = Math.max(
                0,
                button === "in" ? 37_200 - received : received - 37_200,
              );
              return {
                __typename: "LotterySettlementButton" as const,
                button,
                defaultAmount,
                canUse: defaultAmount > 0,
              };
            }),
          },
        ],
        records: [
          {
            __typename: "LotterySettlementRecord",
            id: "cash-w1",
            method: "cash",
            side: "shipper",
            type: "wholesale_in",
            direction: "in",
            amount: received,
            accountLabel: null,
            cashPlace: "vault",
            cashPointName: null,
            cashPointPrinterId: null,
            handler: "王小明",
            note: null,
            occurredAt: "2026-11-18T06:05:00.000Z",
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
