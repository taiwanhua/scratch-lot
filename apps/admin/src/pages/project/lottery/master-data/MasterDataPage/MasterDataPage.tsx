import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";
import { useUrlState } from "@/hooks/base/useUrlState";
import { LIST_PAGE_SHELL_SX } from "@/lib/base/list-page-layout";

import { CashPointsTab } from "../CashPointsTab/CashPointsTab";
import { GamesTab } from "../GamesTab/GamesTab";
import { MASTER_DATA_TABS } from "../master-data-config";
import { useMasterDataAccess } from "../useMasterDataAccess";

/** 與 `PageTabs` 同一個 `?tab=`(只讀,決定右上角是哪一顆新增按鈕);空字串 = 第一個看得到的分頁。 */
const tabSchema = z.string().default("");

/**
 * 檔案管理(`master-data`,規格 3.1 / 16.7;Figma MD-01 97:17、MD-05 97:1120):
 * 分頁 遊戲 | 收銀點(各自要綁 `master-data.games` / `master-data.cash-points` 才出現;只剩一個時不顯示分頁籤)。
 * 右上按鈕跟著分頁換:[+ 新增遊戲](導向新增頁)/ [+ 新增收銀點](彈窗)。
 */
export const MasterDataPage = () => {
  const t = useTranslations("admin.lotteryMasterData");
  const navigate = useNavigate();
  const access = useMasterDataAccess();
  const [tab] = useUrlState("tab", tabSchema);
  const [isCreatingCashPoint, setCreatingCashPoint] = useState(false);

  const items: PageTabItem[] = [
    ...(access.hasGames
      ? [
          {
            value: MASTER_DATA_TABS.games,
            label: t("tabs.games"),
            content: <GamesTab viewRoute={access.gameViewRoute} />,
          },
        ]
      : []),
    ...(access.hasCashPoints
      ? [
          {
            value: MASTER_DATA_TABS.cashPoints,
            label: t("tabs.cashPoints"),
            content: (
              <CashPointsTab
                isCreating={isCreatingCashPoint}
                onCloseCreate={() => {
                  setCreatingCashPoint(false);
                }}
              />
            ),
          },
        ]
      : []),
  ];
  const currentTab =
    items.find((item) => item.value === tab)?.value ?? items[0]?.value;

  let action: ReactNode;
  if (currentTab === MASTER_DATA_TABS.games && access.canCreateGame) {
    action = (
      <Button
        onClick={() => {
          if (access.gameCreateRoute !== null) {
            void navigate(access.gameCreateRoute);
          }
        }}
      >
        {t("games.new")}
      </Button>
    );
  } else if (
    currentTab === MASTER_DATA_TABS.cashPoints &&
    access.canCreateCashPoint
  ) {
    action = (
      <Button
        onClick={() => {
          setCreatingCashPoint(true);
        }}
      >
        {t("cashPoints.new")}
      </Button>
    );
  }

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
      <PageTabs aria-label={t("tabs.aria")} items={items} actions={action} />
    </Card>
  );
};
