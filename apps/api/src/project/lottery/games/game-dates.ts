import { localDateOf, startOfLocalDay } from "@repo/domain/form";
import { gameDatesOf } from "@repo/domain/project/lottery-master-data";

/** 存進遊戲的三個日期(時點 = 租戶時區那一天的 00:00)。 */
export interface GameDateValues {
  claimDeadline: Date;
  launchedAt: Date;
  discontinuedAt: Date;
}

/**
 * 兌獎截止日 → 要存的三個日期(專案規格 5.1;推算規則正本 `@repo/domain` 的 `gameDatesOf`):
 * 兌獎截止日先收斂成租戶時區那一天的 00:00,再以那一天推算上市日與停售日。
 */
export function gameDateValuesOf(
  claimDeadline: Date,
  timezone: string,
): GameDateValues {
  const deadline = localDateOf(claimDeadline.getTime(), timezone);
  const { launchedAt, discontinuedAt } = gameDatesOf(deadline);
  return {
    claimDeadline: new Date(startOfLocalDay(deadline, timezone)),
    launchedAt: new Date(startOfLocalDay(launchedAt, timezone)),
    discontinuedAt: new Date(startOfLocalDay(discontinuedAt, timezone)),
  };
}
