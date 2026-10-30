import { HttpResponse } from "msw";

import { ACCOUNTS_PERMISSIONS as PERMISSIONS } from "@repo/domain/project/lottery-accounts";
import type {
  CloseLotteryPeriodMutationVariables,
  LotteryPeriodCloseCheckQueryVariables,
  LotteryPeriodCloseQueryVariables,
} from "@repo/graphql";

import { graphqlError } from "../../auth-handlers";
import { api, type server } from "../../server";
import {
  type PeriodCheckFixture,
  type PeriodRowFixture,
  samplePeriodCheck,
  samplePeriodClose,
  samplePeriodRows,
} from "./period-close-fixtures";

export interface PeriodCloseWorldOptions {
  rows?: PeriodRowFixture[];
  /** 檢查清單的覆寫(例:有擋下的項目) */
  check?: (month: string) => PeriodCheckFixture;
  permissions?: readonly string[];
}

export interface PeriodCloseWorld {
  handlers: Parameters<typeof server.use>;
  inputs: { close: CloseLotteryPeriodMutationVariables["input"][] };
}

const validation = (reason: string, fields: string[]) =>
  graphqlError("VALIDATION_FAILED", reason, { reason, fields });

/**
 * 關帳的假 api(夾具在 `period-close-fixtures.ts`;規則照 `docs/modules/project/accounts.md`「關帳」):
 * 有狀態 —— [關帳] 後那個月變已關帳、下一個月可以關;確認月份不同 → `PERIOD_CLOSE_INVALID`;
 * 不是可以關的月份 → `PERIOD_OUT_OF_ORDER`;沒有 `accounts.close-period` → `FORBIDDEN`。
 * 元件測試與 mock 模式共用(經 `accountsWorld`)。
 */
export const periodCloseWorld = ({
  rows = samplePeriodRows(),
  check = (month) => samplePeriodCheck(month),
  permissions = Object.values(PERMISSIONS),
}: PeriodCloseWorldOptions = {}): PeriodCloseWorld => {
  let state = rows;
  const inputs: PeriodCloseWorld["inputs"] = { close: [] };
  const denied = () =>
    permissions.includes(PERMISSIONS.closePeriod)
      ? null
      : graphqlError("FORBIDDEN");
  const handlers: PeriodCloseWorld["handlers"] = [
    api.query("LotteryPeriodCloses", () => {
      const forbidden = denied();
      if (forbidden) return forbidden;
      return HttpResponse.json({
        data: {
          lotteryPeriodCloses: {
            items: state,
            closableMonth: state.find((row) => row.canClose)?.month ?? null,
          },
        },
      });
    }),
    api.query("LotteryPeriodCloseCheck", ({ variables }) => {
      const { month } = variables as LotteryPeriodCloseCheckQueryVariables;
      return HttpResponse.json({
        data: { lotteryPeriodCloseCheck: check(month) },
      });
    }),
    api.query("LotteryPeriodClose", ({ variables }) => {
      const { month } = variables as LotteryPeriodCloseQueryVariables;
      return HttpResponse.json({
        data: { lotteryPeriodClose: samplePeriodClose(month) },
      });
    }),
    api.mutation("CloseLotteryPeriod", ({ variables }) => {
      const forbidden = denied();
      if (forbidden) return forbidden;
      const { input } = variables as CloseLotteryPeriodMutationVariables;
      inputs.close.push(input);
      if (input.confirmMonth !== input.month) {
        return validation("PERIOD_CLOSE_INVALID", ["confirmMonth"]);
      }
      const index = state.findIndex((row) => row.month === input.month);
      const row = state.find((item) => item.month === input.month);
      if (!row?.canClose) {
        return validation("PERIOD_OUT_OF_ORDER", ["month"]);
      }
      if (!check(input.month).canClose) {
        return validation("PERIOD_PENDING_DOCUMENTS", ["month"]);
      }
      const closedAt = new Date().toISOString();
      state = state.map((item, position) => {
        if (position === index) {
          return {
            ...item,
            status: "closed",
            canClose: false,
            closedAt,
            closedBy: {
              __typename: "LotteryAccountsRef" as const,
              id: "user-me",
              name: "何家華",
            },
          };
        }
        // 下一個月(列表新的在前)已結束才可以關
        return position === index - 1 && item.status === "open"
          ? { ...item, canClose: true }
          : item;
      });
      return HttpResponse.json({
        data: {
          closeLotteryPeriod: {
            __typename: "LotteryPeriodClose",
            id: `close-${input.month}`,
            month: input.month,
            closedAt,
          },
        },
      });
    }),
  ];
  return { handlers, inputs };
};
