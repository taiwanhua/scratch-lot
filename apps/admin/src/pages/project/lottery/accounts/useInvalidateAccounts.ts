import { useQueryClient } from "@tanstack/react-query";

import {
  useLotteryBankAccountQuery,
  useLotteryBankAccountsQuery,
  useLotteryBankTransactionsQuery,
  useLotteryOutstandingSettlementsQuery,
} from "@repo/graphql";

/** 帳戶 / 交易寫入後重抓:帳戶列表、帳戶詳情、交易清單、待結清款項(只取 query 名那一段 key)。 */
export const useInvalidateAccounts = () => {
  const queryClient = useQueryClient();
  return () => {
    for (const key of [
      useLotteryBankAccountsQuery.getKey({ input: {} }),
      useLotteryBankAccountQuery.getKey({ id: "" }),
      useLotteryBankTransactionsQuery.getKey({ input: { accountId: "" } }),
      useLotteryOutstandingSettlementsQuery.getKey(),
    ]) {
      void queryClient.invalidateQueries({ queryKey: key.slice(0, 1) });
    }
  };
};
