import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "use-intl";

import {
  type LotteryWholesaleScanMatchesQuery,
  useLotteryWholesaleScanMatchesQuery,
} from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import type { FormError } from "@/lib/base/form-engine/form-errors";

import { displayBookNo } from "../wholesale-keys";
import type { WholesaleDraftLine } from "./wholesale-form";

type ScanMatch =
  LotteryWholesaleScanMatchesQuery["lotteryWholesaleScanMatches"][number];

/** 送出被擋時要逐列列出原因的錯誤碼。 */
const BLOCKED_REASON = "WHOLESALE_BOOK_UNAVAILABLE";

/**
 * 不能批售的原因(規格 21.3「刷到不能批售的本,在輸入框下方當下寫原因」):
 *
 * - `explain`:刷到的本不在可批售的本裡 → 問 api 這本現在的狀態,回原因的文字
 * - `blockedRows`:送出被擋(`WHOLESALE_BOOK_UNAVAILABLE`)時重新問每一列,寫出哪一本與原因
 */
export const useWholesaleChecks = (
  fromOrgId: string,
  lines: readonly WholesaleDraftLine[],
  error: FormError | null,
) => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.create");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const matchesOf = async (
    bookNo: string,
    gameCode: string | null,
  ): Promise<ScanMatch[]> => {
    const variables = { fromOrgId, bookNo, gameCode };
    const data = await queryClient.fetchQuery({
      queryKey: useLotteryWholesaleScanMatchesQuery.getKey(variables),
      queryFn: useLotteryWholesaleScanMatchesQuery.fetcher(
        session.client,
        variables,
      ),
      staleTime: 0,
    });
    return data.lotteryWholesaleScanMatches;
  };
  const problemText = (match: ScanMatch): string | null =>
    match.problem === null || match.problem === undefined
      ? null
      : t(`problems.${match.problem}`, {
          bookNo: displayBookNo(match.bookNo),
          serialNo: match.lockedSerialNo ?? "—",
        });

  const explain = async (
    bookNo: string,
    gameCode: string | null,
    pickedGameId: string | null,
  ): Promise<string> => {
    const found = await matchesOf(bookNo, gameCode);
    const matches =
      gameCode === null && pickedGameId !== null
        ? found.filter((match) => match.gameId === pickedGameId)
        : found;
    const first = matches.at(0);
    if (first === undefined) {
      return t("scanNotFound");
    }
    return matches.length > 1
      ? t("scanAmbiguousGame")
      : (problemText(first) ?? t("scanStale"));
  };

  // 送出被擋的那一刻重新問(以這次的錯誤為 key;之後怎麼改明細不重問,移除後再送就好)
  const isBlocked = error?.projectReason === BLOCKED_REASON;
  const blocked = useQuery({
    queryKey: ["WholesaleBlockedRows", fromOrgId, error],
    enabled: isBlocked,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async (): Promise<string[]> => {
      const rows = await Promise.all(
        lines.map(async (line) => {
          const matches = await matchesOf(line.book.bookNo, line.book.gameCode);
          const match = matches.find(
            (item) => item.bookId === line.book.bookId,
          );
          return match === undefined ? null : problemText(match);
        }),
      );
      return rows.filter((row) => row !== null);
    },
  });
  return { explain, blockedRows: isBlocked ? (blocked.data ?? []) : [] };
};
