import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { INVENTORY_PERMISSIONS } from "@repo/domain/project/lottery";
import { Button } from "@repo/ui/button";
import { Typography } from "@repo/ui/typography";

import { OpeningFixDialog } from "@/components/project/lottery/OpeningFixDialog/OpeningFixDialog";
import { usePermissions } from "@/hooks/base/usePermissions";

import type { RescanItem } from "./rescan-model";
import { useRescanText } from "./useRescanText";

/**
 * 全店重刷「導入前已賣出但還在」的 [期初更正 #張號](期初建檔規格 4.2):當下改回未售、預設放刷到的位置。
 * 沒有 `inventory.opening` → 寫「請店長做期初更正」;更正過(`openingSold` = false)→ 不顯示。
 */
export const RescanOpeningFix = ({
  item,
  orgId,
  gameCode,
}: {
  item: RescanItem;
  orgId: string;
  gameCode: string;
}) => {
  const { t } = useRescanText();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  if (item.outcome !== "opening_sold_here" || !item.openingSold) {
    return null;
  }
  if (!hasPermission(INVENTORY_PERMISSIONS.opening)) {
    return (
      <Typography variant="body2" color="textSecondary">
        {t("openingFix.noPermission")}
      </Typography>
    );
  }
  return (
    <>
      <Button
        variant="outlined"
        size="small"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t("openingFix.button", { ticketNo: item.ticketNo })}
      </Button>
      {open ? (
        <OpeningFixDialog
          orgId={orgId}
          book={{ gameCode, bookNo: item.bookNo }}
          tickets={[
            {
              id: item.ticketId,
              version: item.version,
              ticketNo: item.ticketNo,
            },
          ]}
          to="unsold"
          defaultCashPointId={item.cashPointId ?? null}
          onClose={() => {
            setOpen(false);
          }}
          onFixed={() => {
            void queryClient.invalidateQueries({ queryKey: ["LotteryRescan"] });
          }}
        />
      ) : null}
    </>
  );
};
