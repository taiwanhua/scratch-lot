import type { ReactNode } from "react";
import { useNavigate } from "react-router";

import { STORE_KEY } from "@repo/domain/project/lottery";
import { useLotteryStocktakeStatusQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useSession } from "@/hooks/base/useSession";

import { RescanReminderAlerts } from "./RescanReminderAlerts";
import {
  type RescanBrief,
  pendingPlaceNamesOf,
  rescanHref,
} from "./rescan-model";
import { useRescanStart } from "./useRescanStart";
import { useRescanText } from "./useRescanText";

export interface RescanEntry {
  /** 看板頂部:進行中的重刷(暫停移櫃、已刷幾個位置、還沒刷的、剩幾分鐘;[前往重刷])與重刷提醒 */
  banners: ReactNode;
  /** 收銀點標題列的「這裡還沒刷遊戲 X」 */
  noticesOf: (cashPointId: string) => string[];
  /** 開始全店重刷的確認視窗 */
  element: ReactNode;
  /** 進行中的重刷(盤點入口的 8.5a 提醒) */
  rescans: readonly RescanBrief[];
}

/**
 * 看板的全店重刷(張數店規格 8.3、8.5、13.2;Figma CS-01c):頂部的重刷中橫幅([前往重刷])與重刷提醒
 * ([全店重刷 遊戲 X]);還沒刷的收銀點標題列加「這裡還沒刷遊戲 X」。資料是 `lotteryStocktakeStatus`
 * (看板信號 `board` 重抓;開始、每個位置刷完、結束都會送)。
 */
export const useRescanEntry = (
  orgId: string,
  cashPoints: readonly { id: string; name: string }[],
): RescanEntry => {
  const { t, gameOf } = useRescanText();
  const { session } = useSession();
  const navigate = useNavigate();
  const access = useFormModuleAccess(STORE_KEY);
  const status = useLotteryStocktakeStatusQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "", retry: false },
  );
  const starter = useRescanStart(orgId, cashPoints);
  const rescans = status.data?.lotteryStocktakeStatus.rescans ?? [];
  const reminders = status.data?.lotteryStocktakeStatus.rescanReminders ?? [];
  const createRoute = access.createRoute;
  return {
    rescans,
    banners: (
      <>
        {rescans.map((rescan) => (
          <Alert
            key={rescan.id}
            severity="info"
            action={
              createRoute === null ? undefined : (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => {
                    void navigate(rescanHref(createRoute, orgId, rescan.id));
                  }}
                >
                  {t("banner.go")}
                </Button>
              )
            }
          >
            <Box component="span">
              {t("banner.active", {
                game: gameOf(rescan),
                done: rescan.doneCount,
                total: rescan.places.length,
                pending: pendingPlaceNamesOf(
                  rescan.places,
                  t("page.stock"),
                ).join("、"),
                minutes: rescan.minutesLeft,
              })}
            </Box>
          </Alert>
        ))}
        <RescanReminderAlerts reminders={reminders} onStart={starter.open} />
      </>
    ),
    noticesOf: (cashPointId) =>
      rescans.flatMap((rescan) =>
        rescan.places.some(
          (place) =>
            place.cashPointId === cashPointId && place.state !== "done",
        )
          ? [t("banner.pendingChip", { code: rescan.gameCode })]
          : [],
      ),
    element: starter.element,
  };
};
