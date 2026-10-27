import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  useLotteryDealerCoSellersQuery,
  useLotteryDealerContactQuery,
  useLotteryDealerContactsQuery,
  useLotteryDealerQuery,
  useLotteryDealerSigninsQuery,
  useLotteryDealersQuery,
  useLotteryOccupiedStoresQuery,
} from "@repo/graphql";

import { useInvalidateSidebarBadges } from "@/hooks/base/useSidebarBadges";

/**
 * 經銷商管理的寫入之後:失效本模組的清單與單筆(DATA-02 / 04),另失效側欄計數
 * (證照到期日、批購基準日變了數字就會變)。
 */
export const useInvalidateDealers = () => {
  const queryClient = useQueryClient();
  const invalidateBadges = useInvalidateSidebarBadges();
  return useCallback(async () => {
    const keys = [
      useLotteryDealersQuery.getKey({ input: { type: undefined as never } }),
      useLotteryDealerQuery.getKey({ id: "" }),
      useLotteryDealerContactsQuery.getKey({ input: {} }),
      useLotteryDealerContactQuery.getKey({ id: "" }),
      useLotteryDealerSigninsQuery.getKey({ dealerId: "", year: 0 }),
      useLotteryDealerCoSellersQuery.getKey({ dealerId: "" }),
      useLotteryOccupiedStoresQuery.getKey(),
    ];
    await Promise.all(
      keys.map((key) =>
        queryClient.invalidateQueries({ queryKey: key.slice(0, 1) }),
      ),
    );
    invalidateBadges();
  }, [queryClient, invalidateBadges]);
};
