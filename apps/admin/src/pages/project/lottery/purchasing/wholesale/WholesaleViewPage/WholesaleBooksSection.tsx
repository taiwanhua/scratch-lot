import { useTranslations } from "use-intl";

import {
  FormSubmissionStatus,
  type LotteryWholesaleDetailQuery,
} from "@repo/graphql";

import {
  BookGroupList,
  type BookRowStatus,
} from "@/components/project/lottery/BookGroupList/BookGroupList";
import { groupBooksByGame } from "@/components/project/lottery/BookGroupList/book-groups";

import { useWholesaleListLabels } from "../useWholesaleListLabels";
import { displayBookNo } from "../wholesale-keys";

export interface WholesaleBooksSectionProps {
  status: FormSubmissionStatus;
  detail: LotteryWholesaleDetailQuery["lotteryWholesaleDetail"];
}

/** 單據狀態 → 每一本的狀態(審核中 = 批售中、已完成 = 已批售;其他不顯示)。 */
const ROW_STATUS: Partial<Record<FormSubmissionStatus, BookRowStatus>> = {
  [FormSubmissionStatus.Reviewing]: "wholesaling",
  [FormSubmissionStatus.Completed]: "wholesaled",
};

/** 批售單的本清單(唯讀;規格 21.3「檢視頁」,Figma WS-03a / WS-03d);檢視頁與申請中心詳情頁共用。 */
export const WholesaleBooksSection = ({
  status,
  detail,
}: WholesaleBooksSectionProps) => {
  const t = useTranslations("admin.lotteryPurchasing.wholesale.create");
  const labels = useWholesaleListLabels();
  const groups = groupBooksByGame(
    detail.rows,
    (row) => ({
      key: row.gameId,
      title: `${row.gameCode} ${row.gameName}`,
    }),
    (row) => ({
      rowId: row.rowId,
      bookNo: displayBookNo(row.bookNo),
      ticketText: "",
      tickets: row.tickets,
      bookPrice: row.bookPrice,
      rate: row.rate,
      amount: row.amount,
      status: ROW_STATUS[status] ?? null,
    }),
  );
  return (
    <BookGroupList
      mode="view"
      title={t("lines")}
      labels={labels}
      groups={groups}
    />
  );
};
