import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";
import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useModuleForms } from "@/hooks/base/useModuleForms";
import { useSnackbar } from "@/hooks/base/useMutationFeedback";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useUrlState } from "@/hooks/base/useUrlState";

import { PurchaseListTab } from "../PurchaseListTab/PurchaseListTab";
import { usePurchaseList } from "../PurchaseListTab/usePurchaseList";
import { RequisitionsTab } from "../RequisitionsTab/RequisitionsTab";
import {
  REQUISITION_FORM_KEY,
  REQUISITION_MODULE_KEY,
  REQUISITION_PERMISSIONS,
  REQUISITION_TABS,
} from "../purchasing-keys";

/** 與 `PageTabs` 同一個 `?tab=`(只讀,決定右上角是哪一顆按鈕);空字串 = 第一個看得到的分頁。 */
const tabSchema = z.string().default("");

/** 採購清單分頁的 [匯出 Excel](內容 = 畫面上的表;失敗以提示告知)。 */
const PurchaseListExportButton = () => {
  const t = useTranslations("admin.lotteryPurchasing.purchaseList");
  const showSnackbar = useSnackbar();
  const { list, exportExcel, isExporting } = usePurchaseList();
  return (
    <Button
      variant="outlined"
      disabled={isExporting || list === null || list.rows.length === 0}
      onClick={() => {
        void exportExcel().then((isDone) => {
          if (!isDone) {
            showSnackbar("error", t("exportFailed"));
          }
        });
      }}
    >
      {t("export")}
    </Button>
  );
};

/**
 * 叫貨、採購單(`purchasing.requisition`,表單模組的列表頁換成分頁頁殼;規格 3.1、8.1;
 * Figma PU-01 92:1017、PU-03 92:1340):分頁 叫貨單 | 採購清單(要 `purchase-list`,沒有就看不到;
 * 只剩一個分頁時不顯示分頁籤)。右上按鈕跟著分頁換:[+ 新增叫貨單](有新增權限)/ [匯出 Excel]。
 * 詳情 / 編輯沿用表單引擎;新增頁是替換的 `RequisitionCreatePage`。
 */
export const RequisitionPage = () => {
  const t = useTranslations("admin.lotteryPurchasing");
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const access = useFormModuleAccess(REQUISITION_MODULE_KEY);
  const { creatableForms } = useModuleForms(REQUISITION_MODULE_KEY);
  const [tab] = useUrlState("tab", tabSchema);
  const canCreate =
    access.createRoute !== null &&
    creatableForms.some((form) => form.key === REQUISITION_FORM_KEY);

  const items: PageTabItem[] = [
    {
      value: REQUISITION_TABS.requisitions,
      label: t("tabs.requisitions"),
      content: <RequisitionsTab />,
    },
    {
      value: REQUISITION_TABS.purchaseList,
      label: t("tabs.purchaseList"),
      permission: REQUISITION_PERMISSIONS.purchaseList,
      content: <PurchaseListTab />,
    },
  ];
  const visibleTabs = items.filter(
    (item) => item.permission === undefined || hasPermission(item.permission),
  );
  const currentTab =
    visibleTabs.find((item) => item.value === tab)?.value ??
    visibleTabs[0]?.value;

  let action: ReactNode = null;
  if (currentTab === REQUISITION_TABS.requisitions && canCreate) {
    action = (
      <Button
        onClick={() => {
          void navigate(`${access.createRoute ?? ""}/${REQUISITION_FORM_KEY}`);
        }}
      >
        {t("requisitions.create")}
      </Button>
    );
  } else if (currentTab === REQUISITION_TABS.purchaseList) {
    action = <PurchaseListExportButton />;
  }

  return (
    <Card
      sx={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        px: { xs: 2, sm: 3 },
        py: 2,
      }}
    >
      <PageTabs aria-label={t("tabs.aria")} items={items} actions={action} />
    </Card>
  );
};
