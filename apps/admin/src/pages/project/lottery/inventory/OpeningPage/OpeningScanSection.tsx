import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import { INVENTORY_OPENING_SCAN_PURPOSE } from "@repo/domain/project/lottery";
import { useLotteryGamesQuery } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";

import { BookScanBar } from "@/components/project/lottery/BookScanBar/BookScanBar";
import { useSession } from "@/hooks/base/useSession";

import { useInventoryAccess } from "../useInventoryAccess";
import type { OpeningScanMessage } from "./useOpeningScan";

/** 「正面條碼的遊戲」下拉一次載入的筆數(api 上限)。 */
const GAME_OPTIONS_PAGE_SIZE = 100;

export interface OpeningScanSectionProps {
  onScan: (code: string) => Promise<boolean>;
  message: OpeningScanMessage | null;
  disabled: boolean;
  fallbackGameId: string | null;
  onFallbackGameChange: (gameId: string | null) => void;
}

/**
 * 期初建檔頁的提示 + 刷條碼列(Figma OP-01a、OP-04;規格 3.1、D7):「同一款遊戲,請先登記先賣的那本」→
 * 沿用進貨單的刷條碼列(正面條碼的遊戲 + 輸入欄;擋下的原因固定在下方,已在系統裡附 [本的詳情])。
 */
export const OpeningScanSection = ({
  onScan,
  message,
  disabled,
  fallbackGameId,
  onFallbackGameChange,
}: OpeningScanSectionProps) => {
  const t = useTranslations("admin.lotteryInventory.opening");
  const { session } = useSession();
  const navigate = useNavigate();
  const { bookRoute } = useInventoryAccess();
  const games = useLotteryGamesQuery(session.client, {
    input: { page: 1, pageSize: GAME_OPTIONS_PAGE_SIZE },
  });
  const bookId = message?.bookId;
  const action =
    bookId === undefined || bookRoute === null ? null : (
      <Button
        variant="outlined"
        onClick={() => {
          void navigate(`${bookRoute}/${bookId}`);
        }}
      >
        {t("openBook")}
      </Button>
    );
  return (
    <>
      <Alert severity="info">{t("hint")}</Alert>
      <BookScanBar
        purpose={INVENTORY_OPENING_SCAN_PURPOSE}
        label={t("scan")}
        disabled={disabled}
        onScan={onScan}
        gamePicker={{
          label: t("fallbackGame"),
          noneLabel: t("fallbackGameNone"),
          options: (games.data?.lotteryGames.items ?? []).map((game) => ({
            value: game.id,
            label: `${game.gameCode} ${game.name}`,
          })),
          value: fallbackGameId,
          onChange: onFallbackGameChange,
        }}
        message={
          message === null
            ? null
            : { severity: message.severity, text: message.text }
        }
        action={action}
      />
    </>
  );
};
