import type { ReactNode } from "react";
import { useTranslations } from "use-intl";

import { INVENTORY_KEY } from "@repo/domain/project/lottery";
import type {
  LotteryDealerFieldsFragment,
  LotteryGameFieldsFragment,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";

import { useMe } from "@/hooks/base/useMe";

import { AllocationsTable } from "../AllocationsTable/AllocationsTable";
import { StockOverviewTable } from "../StockOverviewTable/StockOverviewTable";

/** 這些分頁讀庫存管理的資料:沒綁庫存管理時只顯示說明(api 也會擋)。 */
const InventoryGate = ({ children }: { children: ReactNode }) => {
  const t = useTranslations("admin.lotteryInventory.detailTabs");
  const me = useMe();
  const hasInventory = (me.data?.me.modules ?? []).some(
    (module) => module.key === INVENTORY_KEY,
  );
  return hasInventory ? (
    children
  ) : (
    <Alert severity="info">{t("noAccess")}</Alert>
  );
};

/** 遊戲詳情「庫存概況」(規格 5.1;Figma MD-03):各分店未拆 / 檯面 / 已售。 */
export const GameStockTab = ({ game }: { game: LotteryGameFieldsFragment }) => (
  <InventoryGate>
    <StockOverviewTable input={{ gameId: game.id }} rowsBy="stores" />
  </InventoryGate>
);

/** 遊戲詳情「預計要給本數」(規格 5.1、7.6):與庫存管理同一份資料與權限。 */
export const GameAllocationsTab = ({
  game,
}: {
  game: LotteryGameFieldsFragment;
}) => (
  <InventoryGate>
    <AllocationsTable input={{ gameId: game.id }} rowsBy="stores" />
  </InventoryGate>
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
  <InventoryGate>
    {dealer.storeOrg ? (
      <AllocationsTable input={{ orgId: dealer.storeOrg.id }} rowsBy="games" />
    ) : (
      <NoStore />
    )}
  </InventoryGate>
);

/** 乙類詳情「在店庫存」(規格 5.2):對應分店各遊戲的未拆 / 檯面 / 已售。 */
export const DealerStockTab = ({
  dealer,
}: {
  dealer: LotteryDealerFieldsFragment;
}) => (
  <InventoryGate>
    {dealer.storeOrg ? (
      <StockOverviewTable
        input={{ orgId: dealer.storeOrg.id }}
        rowsBy="games"
      />
    ) : (
      <NoStore />
    )}
  </InventoryGate>
);
