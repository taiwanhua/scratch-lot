import { useTranslations } from "use-intl";

import type {
  LotteryDealerFieldsFragment,
  LotteryGameFieldsFragment,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";

import { AllocationsTable } from "../AllocationsTable/AllocationsTable";
import { StockOverviewTable } from "../StockOverviewTable/StockOverviewTable";

/** 遊戲詳情「庫存概況」(規格 5.1;Figma MD-03):各分店未拆 / 檯面 / 已售。 */
export const GameStockTab = ({ game }: { game: LotteryGameFieldsFragment }) => (
  <>
    <StockOverviewTable input={{ gameId: game.id }} rowsBy="stores" />
  </>
);

/** 遊戲詳情「預計要給本數」(規格 5.1、7.6):與庫存管理同一份資料與權限。 */
export const GameAllocationsTab = ({
  game,
}: {
  game: LotteryGameFieldsFragment;
}) => (
  <>
    <AllocationsTable input={{ gameId: game.id }} rowsBy="stores" />
  </>
);

/** 乙類還沒有對應分店時的說明。 */
const NoStore = () => {
  const t = useTranslations("admin.lotteryInventory.detailTabs");
  return <Alert severity="info">{t("noStore")}</Alert>;
};

/** 乙類詳情「預計要給本數」(規格 5.2、7.6):對應分店的每個遊戲。 */
export const DealerAllocationsTab = ({
  dealer,
}: {
  dealer: LotteryDealerFieldsFragment;
}) => (
  <>
    {dealer.storeOrg ? (
      <AllocationsTable input={{ orgId: dealer.storeOrg.id }} rowsBy="games" />
    ) : (
      <NoStore />
    )}
  </>
);

/** 乙類詳情「在店庫存」(規格 5.2):對應分店各遊戲的未拆 / 檯面 / 已售。 */
export const DealerStockTab = ({
  dealer,
}: {
  dealer: LotteryDealerFieldsFragment;
}) => (
  <>
    {dealer.storeOrg ? (
      <StockOverviewTable
        input={{ orgId: dealer.storeOrg.id }}
        rowsBy="games"
      />
    ) : (
      <NoStore />
    )}
  </>
);
