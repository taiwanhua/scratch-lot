import { useMemo } from "react";

import { useLotteryRequisitionStatesQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

import { REQUISITION_MODULE_KEY } from "../purchasing-keys";
import {
  type SubmissionColumn,
  useFormListColumns,
} from "../shared/useFormListColumns";
import { RequisitionStatusTag } from "./RequisitionStatusTag";
import { type RequisitionRow, completedIdsOf } from "./requisitions";

/** 列表 / 卡片的一欄:表頭 + 一格怎麼畫。 */
export type RequisitionColumn = SubmissionColumn;

/**
 * 叫貨單列表的欄位:讀 `purchasing.requisition` 的列表欄位配置(初值:單號、叫貨分店、期望到貨日、本數),
 * 內建欄「狀態」把已完成再細分 待購買 / 已進貨 / 已調貨(`lotteryRequisitionStates`);「建立者」照底座。
 */
export const useRequisitionColumns = (
  rows: readonly RequisitionRow[],
): RequisitionColumn[] => {
  const { session } = useSession();
  const completedIds = completedIdsOf(rows);
  const statesQuery = useLotteryRequisitionStatesQuery(
    session.client,
    { requisitionIds: completedIds },
    { enabled: completedIds.length > 0 },
  );
  const states = useMemo(
    () =>
      new Map(
        (statesQuery.data?.lotteryRequisitionStates ?? []).map((item) => [
          item.requisitionId,
          item.state,
        ]),
      ),
    [statesQuery.data],
  );
  return useFormListColumns(REQUISITION_MODULE_KEY, rows, {
    renderStatus: (row) => <RequisitionStatusTag row={row} states={states} />,
  });
};
