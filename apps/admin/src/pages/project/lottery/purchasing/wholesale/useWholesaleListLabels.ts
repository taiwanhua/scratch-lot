import { useTranslations } from "use-intl";

import type { BookListLabels } from "@/components/project/lottery/BookGroupList/BookGroupList";

import { formatMoney } from "./wholesale-keys";

/** 批售單本清單(`BookGroupList`)的詞:沒有張號欄;組標題已寫本數,不另寫進度。新增 / 編輯 / 檢視共用。 */
export const useWholesaleListLabels = (): BookListLabels => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.create");
  const tStates = useTranslations("admin.lotteryPurchasing.wholesale.states");
  const tReceive = useTranslations("admin.lotteryPurchasing.receive");
  return {
    columns: {
      bookNo: t("columns.book"),
      tickets: t("columns.tickets"),
      bookPrice: t("columns.bookPrice"),
      rate: t("columns.rate"),
      amount: t("columns.amount"),
      status: t("columns.status"),
    },
    status: {
      received: tReceive("received"),
      notReceived: tReceive("notReceived"),
      inTransit: tReceive("inTransit"),
      partial: tReceive("partial"),
      wholesaling: tStates("wholesaling"),
      wholesaled: tStates("wholesaled"),
    },
    remove: t("remove"),
    rateOf: (row) => t("rateOf", { bookNo: row.bookNo }),
    groupRate: t("groupRate"),
    cardFacts: (row) =>
      t("cardFacts", {
        tickets: row.tickets,
        price: formatMoney(row.bookPrice),
        rate: row.rate,
        amount: formatMoney(row.amount),
      }),
    progress: () => "",
  };
};
