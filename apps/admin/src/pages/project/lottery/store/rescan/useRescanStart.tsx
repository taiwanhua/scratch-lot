import { useState } from "react";
import { useNavigate } from "react-router";

import { STORE_KEY, STORE_PERMISSIONS } from "@repo/domain/project/lottery";
import { useStartLotteryRescanMutation } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";

import { rescanHref } from "./rescan-model";
import { useRescanText } from "./useRescanText";

/** 要開始重刷的遊戲(提醒那一列帶入)。 */
export interface RescanTarget {
  gameId: string;
  gameCode: string;
  gameName: string;
}

/**
 * [全店重刷 遊戲 X] → 「開始全店重刷?」(張數店規格 8.4、8.5a 的提醒時機;Figma CS-10a):列出要刷的位置
 * (各收銀點與庫存)、開始前先完成交班或盤點並先盤點遊戲 X、重刷中暫停 X 的移櫃與 1 小時自動取消;
 * [開始全店重刷] 後前往重刷頁。沒有 `store.stocktake` → `open` = null(不顯示按鈕)。
 */
export const useRescanStart = (
  orgId: string,
  cashPoints: readonly { id: string; name: string }[],
) => {
  const { t, gameOf, errorText } = useRescanText();
  const { session } = useSession();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const access = useFormModuleAccess(STORE_KEY);
  const [target, setTarget] = useState<RescanTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = useStartLotteryRescanMutation(session.client);
  const createRoute = access.createRoute;
  const canStart =
    hasPermission(STORE_PERMISSIONS.stocktake) && createRoute !== null;
  const names = [...cashPoints.map((point) => point.name), t("page.stock")];
  const close = () => {
    setTarget(null);
    setError(null);
  };
  return {
    open: canStart
      ? (next: RescanTarget) => {
          setError(null);
          setTarget(next);
        }
      : null,
    element: (
      <Dialog
        open={target !== null}
        onClose={close}
        fullWidth
        maxWidth="xs"
        title={
          target === null ? "" : t("start.title", { game: gameOf(target) })
        }
        actions={
          <>
            <Button variant="text" onClick={close}>
              {t("start.cancel")}
            </Button>
            <Button
              variant="contained"
              disabled={start.isPending}
              onClick={() => {
                if (target === null || createRoute === null) {
                  return;
                }
                start.mutate(
                  { input: { orgId, gameId: target.gameId } },
                  {
                    onSuccess: (data) => {
                      close();
                      void navigate(
                        rescanHref(
                          createRoute,
                          orgId,
                          data.startLotteryRescan.id,
                        ),
                      );
                    },
                    onError: (failure) => {
                      setError(errorText(failure, target.gameCode));
                    },
                  },
                );
              }}
            >
              {t("start.submit")}
            </Button>
          </>
        }
      >
        {target === null ? null : (
          <Stack spacing={2}>
            <Typography variant="body2" color="textSecondary">
              {t("start.before", { code: target.gameCode })}
            </Typography>
            <Stack
              direction="row"
              spacing={2}
              sx={{ justifyContent: "space-between" }}
            >
              <Typography variant="body2" color="textSecondary">
                {t("start.places")}
              </Typography>
              <Typography variant="body1" sx={{ textAlign: "right" }}>
                {t("start.placesValue", {
                  names: names.join("、"),
                  count: names.length,
                })}
              </Typography>
            </Stack>
            <Typography variant="body2" color="textSecondary">
              {t("start.during", { code: target.gameCode })}
            </Typography>
            {error === null ? null : <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </Dialog>
    ),
  };
};
