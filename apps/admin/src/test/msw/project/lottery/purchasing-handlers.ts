import { HttpResponse } from "msw";

import type {
  LotteryPurchaseListQuery,
  LotteryRequisitionCandidateFieldsFragment,
  LotteryRequisitionCandidatesQueryVariables,
  LotteryRequisitionStatesQueryVariables,
} from "@repo/graphql";

import { api, type server } from "../../server";
import {
  requisitionCandidates,
  purchaseList as samplePurchaseList,
} from "./purchasing-data-fixtures";
import { REQUISITION_STATES } from "./purchasing-fixtures";

/**
 * 叫貨、採購單的假 api(規則照 `docs/modules/project/purchasing.md`):新增頁的遊戲清單、採購清單、
 * 已完成叫貨單的衍生狀態。叫貨單本身(列表、新增、送出)走表單執行端的 world(`requisitionFormWorld`)。
 * 元件測試與 mock 模式共用(`mock/project/mock-world.ts`)。
 */
export interface PurchasingWorldOptions {
  candidates?: LotteryRequisitionCandidateFieldsFragment[];
  purchaseList?: LotteryPurchaseListQuery["lotteryPurchaseList"];
  states?: Readonly<Record<string, string>>;
}

export interface PurchasingWorld {
  handlers: Parameters<typeof server.use>;
  /** 新增頁問過哪些分店 */
  candidateOrgIds: string[];
}

export const purchasingWorld = ({
  candidates = requisitionCandidates(),
  purchaseList = samplePurchaseList(),
  states = REQUISITION_STATES,
}: PurchasingWorldOptions = {}): PurchasingWorld => {
  const candidateOrgIds: string[] = [];
  return {
    candidateOrgIds,
    handlers: [
      api.query("LotteryRequisitionCandidates", ({ variables }) => {
        const { orgId } =
          variables as LotteryRequisitionCandidatesQueryVariables;
        candidateOrgIds.push(orgId);
        return HttpResponse.json({
          data: { lotteryRequisitionCandidates: candidates },
        });
      }),
      api.query("LotteryPurchaseList", () =>
        HttpResponse.json({ data: { lotteryPurchaseList: purchaseList } }),
      ),
      api.query("LotteryRequisitionStates", ({ variables }) => {
        const { requisitionIds } =
          variables as LotteryRequisitionStatesQueryVariables;
        const known = new Map(Object.entries(states));
        const ids = Array.isArray(requisitionIds)
          ? requisitionIds
          : [requisitionIds];
        return HttpResponse.json({
          data: {
            lotteryRequisitionStates: ids.flatMap((id) => {
              const state = known.get(id);
              return state === undefined
                ? []
                : [
                    {
                      __typename: "LotteryRequisitionStateItem",
                      requisitionId: id,
                      state,
                    },
                  ];
            }),
          },
        });
      }),
    ],
  };
};
