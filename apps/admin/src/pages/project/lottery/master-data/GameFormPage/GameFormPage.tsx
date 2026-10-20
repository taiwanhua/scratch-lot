import { useTranslations } from "use-intl";

import { useLotteryGameQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";

import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { MASTER_DATA_MODULE_KEYS } from "../master-data-config";
import { masterDataErrorOf } from "../master-data-error";
import { useMasterDataAccess } from "../useMasterDataAccess";
import { GameForm } from "./GameForm";

/**
 * 遊戲新增 / 編輯頁(隱藏頁 `master-data.games.create-page` / `edit-page` 共版型,情境由 `module.key` 判斷)。
 * 這一層只做 gate:編輯要先把那一筆取回來,資料到了才掛表單(初始值只取一次,REACT-08)。
 */
export const GameFormPage = ({ module, routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryMasterData");
  const { session } = useSession();
  const access = useMasterDataAccess();
  const isEdit = module.key === MASTER_DATA_MODULE_KEYS.gameEditPage;
  const id = routeParam ?? "";
  const query = useLotteryGameQuery(
    session.client,
    { id },
    { enabled: isEdit && id !== "", retry: false },
  );
  const game = query.data?.lotteryGame.item ?? null;
  useRouteTabItemLabel(
    isEdit && game !== null ? `${game.gameCode} ${game.name}` : null,
    "edit",
  );

  if (isEdit && query.isLoading) {
    return <CircularProgress aria-label={t("gameForm.loading")} />;
  }
  if (isEdit && game === null) {
    return (
      <Alert severity="error">
        {t(
          `errors.${query.error === null ? "NOT_FOUND" : masterDataErrorOf(query.error).code}`,
        )}
      </Alert>
    );
  }
  return (
    <Card
      sx={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        px: { xs: 2, sm: 3 },
        py: 2,
      }}
    >
      <GameForm game={isEdit ? game : null} access={access} />
    </Card>
  );
};
