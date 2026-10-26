import { useTranslations } from "use-intl";

import type { BookGroupProgress } from "./BookGroupList";

/**
 * 組標題進度的文字(`BookListLabels.progress`;進貨單、調貨單各使用處共用同一組詞):
 * 「叫貨 5,已刷 4,已點收 2 / 4」,沒有的部分不顯示。
 */
export const useBookProgressLabel = (): ((
  progress: BookGroupProgress,
) => string) => {
  const t = useTranslations("admin.lotteryPurchasing.receive.progress");
  return ({ requested, scanned, received }) =>
    [
      requested === null ? null : t("requested", { count: requested }),
      t("scanned", { count: scanned }),
      received === null
        ? null
        : t("received", { received: received.count, total: received.total }),
    ]
      .filter((part) => part !== null)
      .join(t("separator"));
};
