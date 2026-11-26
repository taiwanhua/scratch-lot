import { HttpResponse } from "msw";

import type {
  LotteryCustomerWholesalesQueryVariables,
  LotterySettlementQueryVariables,
  LotteryWholesaleDetailQueryVariables,
  LotteryWholesaleScanMatchesQueryVariables,
  LotteryWholesalesQueryVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import type { MockSubmission } from "../../form-fixtures";
import { api, type server } from "../../server";
import { masterDataOrgs } from "./master-data-fixtures";
import {
  wholesaleDetail,
  wholesaleOptions,
  wholesaleRows,
  wholesaleSubmissions,
} from "./wholesale-fixtures";
import { wholesaleSettlement } from "./wholesale-settlement-fixtures";

/**
 * 批售單的假 api(規則照 `docs/modules/project/purchasing.md`「批售單」):新增頁選項、刷到不能批售的本的原因、
 * 列表(四種篩選)與篩選選項、檢視內容、批售客戶的批售紀錄、W-0001 的收付。
 * 批售單本身走表單執行端的 world(`wholesaleFormWorld`)。
 */
export interface WholesaleWorld {
  handlers: Parameters<typeof server.use>;
  /** 列表查詢收到的 input(驗篩選有送到 api) */
  listInputs: LotteryWholesalesQueryVariables["input"][];
}

export interface WholesaleWorldOptions {
  /** 新增頁看得到成本(`inventory.show-cost`) */
  showCost?: boolean;
  /** 檢視 / 編輯頁的單(預設示範的四張) */
  submissions?: MockSubmission[];
  /** W-0001 的已收淨額 */
  received?: number;
  /**
   * 收付端點(`LotterySettlement`)怎麼回:`own`(預設)= 批售單自己的,其他單據落到下一個 handler;
   * `none` = 不給(mock 開發模式一個操作只能有一個 handler,由 `transferWorld` 回)
   */
  settlement?: "own" | "none";
}

/** 不能批售的本:本號 → 原因與單號(056540 拆過、056541 調貨中、056542 在別家店)。 */
const PROBLEMS = new Map([
  ["0056540", { problem: "opened", lockedSerialNo: null }],
  ["0056541", { problem: "transferring", lockedSerialNo: "T-0012" }],
  ["0056542", { problem: "elsewhere", lockedSerialNo: null }],
]);

const normalized = (bookNo: string): string => bookNo.padStart(7, "0");

export const wholesaleWorld = ({
  showCost = false,
  submissions = wholesaleSubmissions(),
  received = 20_000,
  settlement = "own",
}: WholesaleWorldOptions = {}): WholesaleWorld => {
  const listInputs: WholesaleWorld["listInputs"] = [];
  const handlers: WholesaleWorld["handlers"] = [
    api.query("LotteryWholesaleOptions", () =>
      HttpResponse.json({
        data: { lotteryWholesaleOptions: wholesaleOptions(showCost) },
      }),
    ),
    api.query("LotteryWholesaleScanMatches", ({ variables }) => {
      const { bookNo } = variables as LotteryWholesaleScanMatchesQueryVariables;
      const key = normalized(bookNo);
      const problem = PROBLEMS.get(key);
      return HttpResponse.json({
        data: {
          lotteryWholesaleScanMatches:
            problem === undefined
              ? []
              : [
                  {
                    __typename: "LotteryWholesaleScanMatch",
                    bookId: `book-${key}`,
                    gameId: "game-5164",
                    gameCode: "5164",
                    bookNo: key,
                    ...problem,
                  },
                ],
        },
      });
    }),
    api.query("LotteryWholesales", ({ variables }) => {
      const { input } = variables as LotteryWholesalesQueryVariables;
      listInputs.push(input);
      const items = wholesaleRows().filter(
        (row) =>
          (input.status == null || row.status === input.status) &&
          (input.paymentMode == null || row.paymentMode === input.paymentMode),
      );
      return HttpResponse.json({
        data: {
          lotteryWholesales: {
            items,
            totalCount: items.length,
            page: input.page ?? 1,
            pageSize: input.pageSize ?? 20,
          },
        },
      });
    }),
    api.query("LotteryWholesaleFilterOptions", () =>
      HttpResponse.json({
        data: {
          lotteryWholesaleFilterOptions: {
            branches: [
              {
                id: masterDataOrgs.storeA.id,
                label: masterDataOrgs.storeA.name,
              },
            ],
            customers: wholesaleOptions().customers,
          },
        },
      }),
    ),
    api.query("LotteryCustomerWholesales", ({ variables }) => {
      const { customerId } =
        variables as LotteryCustomerWholesalesQueryVariables;
      return HttpResponse.json({
        data: {
          lotteryCustomerWholesales:
            customerId === "wholesale-1"
              ? wholesaleRows().filter(
                  (row) => row.customerName === "好運彩券行",
                )
              : [],
        },
      });
    }),
    api.query("LotteryWholesaleDetail", ({ variables }) => {
      const { submissionId } =
        variables as LotteryWholesaleDetailQueryVariables;
      const detail = wholesaleDetail(submissionId, submissions);
      return detail === null
        ? graphqlError("NOT_FOUND")
        : HttpResponse.json({ data: { lotteryWholesaleDetail: detail } });
    }),
    ...(settlement === "none"
      ? []
      : [
          api.query("LotterySettlement", ({ variables }) => {
            const { refId } = variables as LotterySettlementQueryVariables;
            const item = wholesaleSettlement(refId, received);
            return item === null
              ? graphqlError("VALIDATION_FAILED")
              : HttpResponse.json({ data: { lotterySettlement: { item } } });
          }),
        ]),
  ];
  return { handlers, listInputs };
};
