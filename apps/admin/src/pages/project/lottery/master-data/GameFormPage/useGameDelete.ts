import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  useDeleteLotteryGameMutation,
  useLotteryGamesQuery,
} from "@repo/graphql";

import { useCloseItemTabs } from "@/hooks/base/useCloseItemTabs";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import {
  type MasterDataErrorCode,
  masterDataErrorOf,
} from "../master-data-error";
import type { MasterDataAccess } from "../useMasterDataAccess";

/**
 * 刪除遊戲:確認彈窗的開關、送出、成功後關掉這一筆的詳情 / 編輯頁籤並回列表(`useCloseItemTabs`)。
 * 有庫存的遊戲 api 回 `GAME_IN_USE`(畫面上本來就不給按,這裡只是保險)。
 */
export const useGameDelete = (gameId: string, access: MasterDataAccess) => {
  const t = useTranslations("admin.lotteryMasterData");
  const { session } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const closeItemTabs = useCloseItemTabs();
  const [isConfirming, setConfirming] = useState(false);
  const [errorCode, setErrorCode] = useState<MasterDataErrorCode | null>(null);

  const remove = useDeleteLotteryGameMutation(
    session.client,
    useMutationFeedback({
      success: t("feedback.deleteSuccess"),
      error: (error) => t(`errors.${masterDataErrorOf(error).code}`),
      onSuccess: () => {
        setConfirming(false);
        void queryClient.invalidateQueries({
          queryKey: useLotteryGamesQuery.getKey({ input: {} }).slice(0, 1),
        });
        closeItemTabs({
          pageRoutes: [access.gameViewRoute, access.gameEditRoute],
          id: gameId,
          listRoute: access.listRoute,
        });
        if (access.listRoute !== null) {
          void navigate(access.listRoute);
        }
      },
      onError: (error) => {
        setErrorCode(masterDataErrorOf(error).code);
      },
    }),
  );

  return {
    isConfirming,
    errorCode,
    isSubmitting: remove.isPending,
    ask: () => {
      setErrorCode(null);
      setConfirming(true);
    },
    cancel: () => {
      setConfirming(false);
    },
    confirm: () => {
      remove.mutate({ input: { id: gameId } });
    },
  };
};
