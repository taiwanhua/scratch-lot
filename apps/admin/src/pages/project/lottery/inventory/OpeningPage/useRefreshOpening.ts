import { useQueryClient } from "@tanstack/react-query";

/** 建檔 / 作廢後重新讀期初建檔狀態(清單、本數)與庫存列表。 */
export const useRefreshOpening = () => {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["LotteryStoreOpening"] });
    void queryClient.invalidateQueries({
      queryKey: ["LotteryInventoryBooks"],
    });
  };
};
