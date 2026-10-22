import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { useLotteryGameQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import {
  type PageTabItem,
  PageTabs,
} from "@/components/base/PageTabs/PageTabs";
import { useMe } from "@/hooks/base/useMe";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { GameStatusTag } from "../GameStatusTag/GameStatusTag";
import { GAME_DETAIL_TABS } from "../game-detail-tabs";
import { masterDataErrorOf } from "../master-data-error";
import { useMasterDataAccess } from "../useMasterDataAccess";

/**
 * 遊戲詳情頁(隱藏頁 `master-data.games.view-page`;Figma MD-03 97:822):
 * 頂部列([← 返回列表] ……… [編輯],REACT-16)+ 標題卡(代號 名稱 + 狀態、面額 × 張數 · 整本 · 預設批購金額率)
 * + 分頁(`game-detail-tabs.ts`)。
 * [編輯] 看 `abilities.canEdit` 與有沒有綁編輯頁。
 */
export const GameViewPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryMasterData");
  const { session } = useSession();
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const access = useMasterDataAccess();
  const me = useMe();
  const moduleKeys = new Set(
    (me.data?.me.modules ?? []).map((module) => module.key),
  );
  const id = routeParam ?? "";
  const query = useLotteryGameQuery(
    session.client,
    { id },
    { enabled: id !== "", retry: false },
  );
  const game = query.data?.lotteryGame.item ?? null;
  useRouteTabItemLabel(
    game === null ? null : `${game.gameCode} ${game.name}`,
    "view",
  );

  if (query.isLoading) {
    return <CircularProgress aria-label={t("gameForm.loading")} />;
  }
  if (game === null) {
    return (
      <Alert severity="error">
        {t(
          `errors.${query.error === null ? "NOT_FOUND" : masterDataErrorOf(query.error).code}`,
        )}
      </Alert>
    );
  }

  const tabs: PageTabItem[] = GAME_DETAIL_TABS.filter(
    (tab) => tab.visible?.(moduleKeys) ?? true,
  ).map(({ value, labelKey, permission, Content }) => ({
    value,
    label: t(`gameView.tabs.${labelKey}`),
    ...(permission === undefined ? {} : { permission }),
    content: <Content game={game} />,
  }));
  const canEdit = game.abilities.canEdit && access.gameEditRoute !== null;

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      {/* 檢視頁的頂部列(REACT-16):左 [← 返回列表],右 [編輯] */}
      <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
        <Button
          variant="text"
          size="small"
          onClick={() => {
            if (access.listRoute !== null) {
              void navigate(tabHref(access.listRoute));
            }
          }}
        >
          {t("gameView.backToList")}
        </Button>
        <Box sx={{ flex: 1 }} />
        {canEdit && (
          <Button
            onClick={() => {
              if (access.gameEditRoute !== null) {
                void navigate(`${access.gameEditRoute}/${game.id}`);
              }
            }}
          >
            {t("gameView.edit")}
          </Button>
        )}
      </Stack>
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
          <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="h6">
                {game.gameCode} {game.name}
              </Typography>
              <GameStatusTag status={game.status} />
            </Stack>
            <Typography variant="body2" color="textSecondary">
              {t("gameView.summary", {
                unitPrice: game.unitPrice.toLocaleString("en-US"),
                tickets: game.ticketsPerBook,
                bookPrice: game.bookPrice.toLocaleString("en-US"),
                rate: game.defaultRate,
              })}
            </Typography>
          </Stack>
        </Stack>
      </Card>
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 2 }}>
        <PageTabs aria-label={t("gameView.tabs.aria")} items={tabs} />
      </Card>
    </Stack>
  );
};
