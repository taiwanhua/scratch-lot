import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import {
  useLotteryPurchaseListQuery,
  useTenantOrgTreeQuery,
} from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import { flattenOrgs, tenantTreeToOrgNodes } from "@/lib/base/org-tree";
import { downloadWorkbook } from "@/lib/project/reports/excel";

import { formatCount } from "../purchasing-keys";
import { type PurchaseList, purchaseListSheetOf } from "./purchase-list-sheet";

export interface PurchaseListState {
  list: PurchaseList | null;
  isLoading: boolean;
  orgNameOf: (orgId: string) => string;
  gameLabelOf: (row: PurchaseList["rows"][number]) => string;
  /** [匯出 Excel](B11 產生器;內容 = 畫面上的表);回傳是否成功 */
  exportExcel: () => Promise<boolean>;
  isExporting: boolean;
}

/**
 * 採購清單的資料(分頁與頁首的 [匯出 Excel] 共用同一份查詢快取):清單、分店名稱(與分店選擇器同一份
 * 組織樹)、匯出。
 */
export const usePurchaseList = (): PurchaseListState => {
  const t = useTranslations("admin.lotteryPurchasing.purchaseList");
  const { session } = useSession();
  const query = useLotteryPurchaseListQuery(session.client);
  const orgTree = useTenantOrgTreeQuery(session.client);
  const [isExporting, setIsExporting] = useState(false);
  const names = useMemo(
    () =>
      new Map(
        flattenOrgs(
          tenantTreeToOrgNodes(orgTree.data?.tenantOrgTree ?? [], false),
        ).map((org) => [org.id, org.name]),
      ),
    [orgTree.data],
  );
  const orgNameOf = useCallback(
    (orgId: string) => names.get(orgId) ?? orgId,
    [names],
  );
  const gameLabelOf = useCallback(
    (row: PurchaseList["rows"][number]) =>
      t("gameLabel", {
        code: row.gameCode,
        name: row.name,
        price: formatCount(row.unitPrice),
      }),
    [t],
  );
  const list = query.data?.lotteryPurchaseList ?? null;

  const exportExcel = async (): Promise<boolean> => {
    if (list === null) {
      return false;
    }
    setIsExporting(true);
    try {
      await downloadWorkbook({
        fileName: t("fileName"),
        sheets: [
          purchaseListSheetOf(list, orgNameOf, {
            sheetName: t("sheetName"),
            note: t("hint"),
            game: t("columns.game"),
            totalBooks: t("columns.totalBooks"),
            estimatedAmount: t("columns.estimatedAmount"),
            gameLabel: gameLabelOf,
          }),
        ],
      });
      return true;
    } catch {
      return false;
    } finally {
      setIsExporting(false);
    }
  };

  return {
    list,
    isLoading: query.isLoading,
    orgNameOf,
    gameLabelOf,
    exportExcel,
    isExporting,
  };
};
