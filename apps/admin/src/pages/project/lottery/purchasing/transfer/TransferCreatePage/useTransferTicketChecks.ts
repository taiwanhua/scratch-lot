import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { TRANSFER_MODE } from "@repo/domain/project/lottery";
import { useLotteryTransferBookTicketsQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import type { FormError } from "@/lib/base/form-engine/form-errors";
import { localPartsOf } from "@/lib/project/schedule-roster";

import {
  type TransferCell,
  blockedGroupsOf,
  transferCellProblemOf,
} from "./transfer-cells";
import type { TransferDraftLine } from "./transfer-form";

/** 送出被擋時要逐列列出的原因(張數店規格 7.4「送出被擋:錯誤標在那一列,列出哪幾張與現在狀態」)。 */
const BLOCKED_REASON = "TRANSFER_TICKETS_UNAVAILABLE";

/** 不能調的狀態 → 文字 key(`cellStates.*`)與處理方式(`blockedHandling.*`)。 */
const STATE_KEYS: Partial<Record<string, string>> = {
  counter: "counter",
  sold: "sold",
  locked: "locked",
  investigating: "investigating",
  lost: "lost",
  scrapped: "scrapped",
  in_transit: "inTransit",
  skipped: "skipped",
  elsewhere: "elsewhere",
};

/**
 * 調貨單選張的當下檢查與送出被擋的列(張數店規格 7.4,兩種店一樣):
 *
 * - `checkTicket`:刷到或手輸的張,重新拿這本的格子資料判斷能不能調;不能 → 回原因與處理方式的文字(不加進已選)
 * - `blockedRows`:送出被擋(`TRANSFER_TICKETS_UNAVAILABLE`)時,重新拿每一列選張的本的格子資料,
 *   每一列寫出哪幾張、現在是什麼狀態與處理方式(移除那一列或那幾張後可以直接再送)
 */
export const useTransferTicketChecks = (
  fromOrgId: string,
  lines: readonly TransferDraftLine[],
  error: FormError | null,
) => {
  const t = useTranslations("admin.lotteryPurchasing.transfer.create");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const clock = (iso: string): string => localPartsOf(iso, timezone).time;
  const cellsOf = (bookId: string): Promise<TransferCell[]> =>
    queryClient
      .fetchQuery({
        queryKey: useLotteryTransferBookTicketsQuery.getKey({
          fromOrgId,
          bookId,
        }),
        queryFn: useLotteryTransferBookTicketsQuery.fetcher(session.client, {
          fromOrgId,
          bookId,
        }),
        staleTime: 0,
      })
      .then((data) => data.lotteryTransferBookTickets);

  const checkTicket = async (
    bookId: string,
    ticketNo: string,
  ): Promise<string | null> => {
    const cells = await cellsOf(bookId);
    const cell = cells.find((item) => item.ticketNo === ticketNo);
    if (cell === undefined) {
      return t("scanNotFound");
    }
    const problem = transferCellProblemOf(cell, clock);
    return problem === null ? null : t(problem.key, problem.values);
  };

  // 送出被擋的那一刻重新拿格子資料(以這次的錯誤為 key;明細之後怎麼改不重抓,移除後再送就好)
  const isBlocked = error?.projectReason === BLOCKED_REASON;
  const blocked = useQuery({
    queryKey: ["TransferBlockedRows", fromOrgId, error],
    enabled: isBlocked,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async (): Promise<string[]> => {
      const partials = lines.filter(
        (line) => line.mode === TRANSFER_MODE.partial,
      );
      const rows = await Promise.all(
        partials.map(async (line) => {
          const cells = await cellsOf(line.book.bookId);
          return blockedGroupsOf(line.ticketNos, cells).map((group) => {
            const key = STATE_KEYS[group.state] ?? "elsewhere";
            return t("blockedRow", {
              game: `${line.book.gameCode} ${line.book.gameName}`,
              bookNo: line.book.bookNo.replace(/^0/, ""),
              ranges: group.ranges,
              state: t(`cellStates.${key}`),
              handling: t(`blockedHandling.${key}`),
            });
          });
        }),
      );
      return rows.flat();
    },
  });
  const blockedRows = isBlocked ? (blocked.data ?? []) : [];

  return { checkTicket, blockedRows };
};
