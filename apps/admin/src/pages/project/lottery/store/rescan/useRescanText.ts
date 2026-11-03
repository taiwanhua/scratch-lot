import { useTranslations } from "use-intl";

import { DEFAULT_TENANT_TIMEZONE } from "@repo/domain/form";
import { RESCAN_REASONS } from "@repo/domain/project/lottery";

import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { rescanErrorOf } from "@/lib/project/lottery/rescan-error";
import { storeErrorKey } from "@/lib/project/lottery/store-error";
import { localPartsOf } from "@/lib/project/schedule-roster";

/** 遊戲的顯示:「5164 發大財」。 */
const gameOf = (item: { gameCode: string; gameName: string }): string =>
  `${item.gameCode} ${item.gameName}`;

/**
 * 全店重刷畫面共用的文字(`admin.lotteryStore.rescan`):時間(租戶時區 `HH:mm`)、遊戲「5164 發大財」、
 * 錯誤訊息(重刷的原因照 `RESCAN_REASONS`;其他照店面管理的 `errors`)。
 */
export const useRescanText = () => {
  const t = useTranslations("admin.lotteryStore.rescan");
  const store = useTranslations("admin.lotteryStore");
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const clock = (iso: string): string => localPartsOf(iso, timezone).time;
  const errorText = (error: unknown, code = ""): string => {
    const parsed = rescanErrorOf(error);
    switch (parsed.reason) {
      case RESCAN_REASONS.placeStocktaking: {
        return t("errors.placeStocktaking", {
          name: parsed.byName,
          time: parsed.startedAt === null ? "" : clock(parsed.startedAt),
          minutes: parsed.minutesLeft,
        });
      }
      case RESCAN_REASONS.placeBusy: {
        return t("errors.placeBusy", { name: parsed.byName });
      }
      case RESCAN_REASONS.placeDone: {
        return t("errors.placeDone");
      }
      case RESCAN_REASONS.ended: {
        return t("errors.ended");
      }
      case RESCAN_REASONS.notFound: {
        return t("errors.notFound");
      }
      case RESCAN_REASONS.notCountStore: {
        return t("errors.notCountStore");
      }
      case RESCAN_REASONS.startBlocked: {
        return parsed.block === "renumber"
          ? t("errors.startRenumber")
          : t("errors.startRescan", { code });
      }
      default: {
        return store(storeErrorKey(error));
      }
    }
  };
  return { t, clock, gameOf, errorText };
};
