import { useTranslations } from "use-intl";

import { Card } from "@repo/ui/card";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";
import { usePageTabsShellSx } from "@/components/base/PageTabs/usePageTabsShellSx";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { STORE_TAB_ENTRIES } from "../store-tabs";

/**
 * 店面管理(`store`,表單模組的列表頁換成分頁頁殼;規格 3.1、6.1;Figma ST-01 65:15):分頁登記在
 * `store-tabs.ts`,依權限顯示;只剩一個分頁時不顯示分頁籤。表單的詳情 / 新增 / 編輯沿用表單引擎。
 */
export const StorePage = (props: ModulePageProps) => {
  const t = useTranslations("admin.lotteryStore.tabs");
  const items: PageTabItem[] = STORE_TAB_ENTRIES.map(
    ({ value, labelKey, permission, isList, Content }) => ({
      value,
      label: t(labelKey),
      ...(permission === undefined ? {} : { permission }),
      ...(isList === true ? { isList } : {}),
      content: <Content {...props} />,
    }),
  );
  const shellSx = usePageTabsShellSx(items);
  return (
    // 分頁殼(STYLE-08):列表分頁平板以上且視窗夠高時釘高、表格在卡片裡捲;看板等內容分頁、手機寬與矮視窗整頁捲
    <Card
      sx={[
        shellSx,
        {
          display: "flex",
          flexDirection: "column",
          px: { xs: 2, sm: 3 },
          py: 2,
        },
      ]}
    >
      <PageTabs aria-label={t("aria")} items={items} />
    </Card>
  );
};
