import { useEffect, useEffectEvent } from "react";
import { useTranslations } from "use-intl";

import { STORE_PERMISSIONS } from "@repo/domain/project/lottery";

import { useMe } from "@/hooks/base/useMe";
import { usePermissions } from "@/hooks/base/usePermissions";
import { registerDefaultScanHandler } from "@/hooks/base/useScanner/scanner-registry";
import { readLocalCashPoint } from "@/lib/project/lottery/local-cash-point";

import { useStoreSaleFlow } from "./BoardTab/sales/useStoreSaleFlow";

/**
 * 快速銷售(專案規格 6.3、18.3「用途」;Figma ST-06):登記 B10 全域掃描的**預設處理** —— 沒有頁面宣告
 * 掃描用途時刷到刮刮樂,開快速銷售小視窗(Enter 確認、Esc 取消)。店 = 目前組織,收銀點 = 這台裝置在
 * 這家店的本機收銀點;其他情況(別的收銀點、未拆、擋下…)和看板同一套對話框。
 * 要 `store.view` 才登記(刷到時要查張)。掛在後台殼(`app/project/shell-extensions.ts`)。
 */
export const QuickSaleHost = () => {
  const t = useTranslations("admin.lotteryStore");
  const me = useMe();
  const { hasPermission } = usePermissions();
  const orgId = me.data?.me.currentOrg?.id ?? "";
  const localId = orgId === "" ? null : readLocalCashPoint(orgId);
  const flow = useStoreSaleFlow({
    orgId,
    local:
      localId === null ? null : { id: localId, name: t("quickSale.local") },
    mode: "quick",
  });
  const enabled = orgId !== "" && hasPermission(STORE_PERMISSIONS.view);
  const onScan = useEffectEvent((code: string) => {
    flow.handleCode(code);
  });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return registerDefaultScanHandler(({ code }) => {
      onScan(code);
    });
  }, [enabled]);
  return flow.element;
};
