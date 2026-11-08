import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  STOCKTAKE_CONFIRM_FORM_KEY,
  STOCKTAKE_REASONS,
  STORE_KEY,
  STORE_PERMISSIONS,
} from "@repo/domain/project/lottery";
import {
  useLotteryStoreBoardQuery,
  useStartLotteryStocktakeSessionMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { useBlockedText } from "./session-text";
import { sessionFailureOf } from "./useStocktakeSession";

export interface RenumberNoticesProps {
  orgId: string;
}

/**
 * 看板頂部的補點編號提示(張數店規格 9.2、10、13.2;Figma CS-01b),和「建議盤點一次」放在一起:
 *
 * - 轉換中:一直顯示「轉換中:請完成補點編號…」與 [補點編號] → 先登記全店的盤點中(全部遊戲暫停移櫃)→
 *   盤點頁(`?purpose=renumber`,照編號盤點逐本)
 * - 張數店依「補點編號提醒」的週期到了:「建議補點編號(上次 MM/DD)」(補點跟日結一起做)
 * - [補點編號] 被擋:有遊戲正在全店重刷(8.5a B4)、這家店正在盤點(誰、幾點開始、剩幾分鐘)
 *
 * 看板的資料和看板共用同一份查詢(同一個 key,不另外送出)。
 */
export const RenumberNotices = ({ orgId }: RenumberNoticesProps) => {
  const t = useTranslations("admin.lotteryStore.stocktake.renumber");
  const tSession = useTranslations("admin.lotteryStore.stocktake.session");
  const { session } = useSession();
  const navigate = useNavigate();
  const temporal = useTemporalText();
  const blockedText = useBlockedText();
  const { hasPermission } = usePermissions();
  const access = useFormModuleAccess(STORE_KEY);
  const [failure, setFailure] = useState<string | null>(null);
  const board = useLotteryStoreBoardQuery(
    session.client,
    { orgId },
    { enabled: orgId !== "", retry: false },
  ).data?.lotteryStoreBoard.item;
  const start = useStartLotteryStocktakeSessionMutation(session.client);
  const canStart =
    hasPermission(STORE_PERMISSIONS.stocktake) && access.createRoute !== null;
  const renumber = board?.renumber ?? null;
  const last = renumber?.lastRenumberAt ?? null;

  const startRenumber = () => {
    setFailure(null);
    start.mutate(
      { input: { orgId, type: "adhoc", purpose: "renumber" } },
      {
        onSuccess: (data) => {
          const params = new URLSearchParams({
            org: orgId,
            session: data.startLotteryStocktakeSession.sessionId,
            purpose: "renumber",
          });
          void navigate(
            `${access.createRoute ?? ""}/${STOCKTAKE_CONFIRM_FORM_KEY}?${params.toString()}`,
          );
        },
        onError: (error) => {
          const failed = sessionFailureOf(error);
          if (failed.reason === STOCKTAKE_REASONS.renumberBlocked) {
            setFailure(t("blockedRescan"));
          } else if (failed.session === null) {
            setFailure(tSession("startFailed"));
          } else {
            setFailure(blockedText(failed.session));
          }
        },
      },
    );
  };

  return (
    <>
      {board?.countMode === "converting" ? (
        <Alert
          severity="info"
          action={
            canStart ? (
              <Button
                size="small"
                variant="text"
                disabled={start.isPending}
                onClick={startRenumber}
              >
                {t("start")}
              </Button>
            ) : undefined
          }
        >
          {t("converting")}
        </Alert>
      ) : null}
      {board?.countMode !== "converting" && renumber?.due === true ? (
        <Alert severity="warning">
          {last === null
            ? t("dueNever")
            : t("due", { date: temporal(last, "monthDay") })}
        </Alert>
      ) : null}
      {failure === null ? null : (
        <Alert
          severity="warning"
          onClose={() => {
            setFailure(null);
          }}
        >
          {failure}
        </Alert>
      )}
    </>
  );
};
