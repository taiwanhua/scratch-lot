import { useState } from "react";
import { useTranslations } from "use-intl";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";
import { AllocationsTable } from "@/components/project/lottery/AllocationsTable/AllocationsTable";
import { LIST_PAGE_SHELL_SX } from "@/lib/base/list-page-layout";

import { InvestigationsTab } from "../InvestigationsTab/InvestigationsTab";
import { LookupDialog } from "../LookupDialog/LookupDialog";
import { StockTab } from "../StockTab/StockTab";
import { INVENTORY_TABS } from "../inventory-config";

/**
 * 庫存管理(`inventory`,規格 3.1 / 7.3 / 7.4 / 7.6;Figma IN-01 91:17、IN-05 91:1109、IN-06 91:1375):
 * 分頁 庫存 | 待查·遺失 | 預計要給本數(綁了模組就都看得到;本模組沒有 `view`)。
 * 右上 [查刮刮樂](IN-02):刷條碼或輸入背面編號,跳到那一本並標亮那一張。
 */
export const InventoryPage = () => {
  const t = useTranslations("admin.lotteryInventory");
  const [isLookingUp, setLookingUp] = useState(false);

  const items: PageTabItem[] = [
    {
      value: INVENTORY_TABS.stock,
      label: t("tabs.stock"),
      content: <StockTab />,
    },
    {
      value: INVENTORY_TABS.investigations,
      label: t("tabs.investigations"),
      content: <InvestigationsTab />,
    },
    {
      value: INVENTORY_TABS.allocations,
      label: t("tabs.allocations"),
      content: <AllocationsTable input={{}} rowsBy="stores" />,
    },
  ];

  return (
    // 列表分頁的分頁殼(STYLE-08):平板以上且視窗夠高時釘高、表格在卡片裡捲(表頭固定);手機寬與矮視窗不釘高,整頁捲
    <Card
      sx={[
        LIST_PAGE_SHELL_SX,
        {
          display: "flex",
          flexDirection: "column",
          px: { xs: 2, sm: 3 },
          py: 2,
        },
      ]}
    >
      <PageTabs
        aria-label={t("tabs.aria")}
        items={items}
        actions={
          <Button
            variant="outlined"
            onClick={() => {
              setLookingUp(true);
            }}
          >
            {t("lookup.open")}
          </Button>
        }
      />
      {isLookingUp ? (
        <LookupDialog
          onClose={() => {
            setLookingUp(false);
          }}
        />
      ) : null}
    </Card>
  );
};
