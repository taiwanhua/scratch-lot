import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { useLotteryStoreOpeningQuery } from "@repo/graphql";
import { Button } from "@repo/ui/button";

import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";

import { useStockOrgId } from "../StockTab/stock-filters";
import { INVENTORY_PERMISSIONS } from "../inventory-config";
import { useInventoryAccess } from "../useInventoryAccess";

/**
 * 庫存管理頁首的 [期初建檔](Figma IN-01-3 / CS-22-3;期初建檔規格 3):要有 `inventory.opening`、綁了期初建檔頁,
 * 而且庫存分頁選的分店期初建檔還在進行中(`canOpen`)才出現;選到區域 / 最上層組織(api 擋下)不出現。
 */
export const OpeningEntryButton = () => {
  const t = useTranslations("admin.lotteryInventory.stock");
  const { session } = useSession();
  const navigate = useNavigate();
  const { openingRoute } = useInventoryAccess();
  const { hasPermission } = usePermissions();
  const orgId = useStockOrgId();
  const isAllowed =
    openingRoute !== null &&
    orgId !== "" &&
    hasPermission(INVENTORY_PERMISSIONS.opening);
  const query = useLotteryStoreOpeningQuery(
    session.client,
    { orgId },
    { enabled: isAllowed, retry: false },
  );
  if (!isAllowed || query.data?.lotteryStoreOpening.item.canOpen !== true) {
    return null;
  }
  return (
    <Button
      variant="outlined"
      onClick={() => {
        void navigate(`${openingRoute}?org=${encodeURIComponent(orgId)}`);
      }}
    >
      {t("openingEntry")}
    </Button>
  );
};
