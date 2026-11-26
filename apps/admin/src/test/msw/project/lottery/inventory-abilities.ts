import { INVENTORY_PERMISSIONS as PERMISSIONS } from "@repo/domain/project/lottery";
import type { LotteryInventoryBookDetailFieldsFragment } from "@repo/graphql";

/** 本的詳情的 `abilities` 與成本(照 api `inventory-view.service.ts` 的判斷;`has` = 操作者有沒有這個權限)。 */
export const abilitiesFor = (
  detail: LotteryInventoryBookDetailFieldsFragment,
  has: (key: string) => boolean,
): LotteryInventoryBookDetailFieldsFragment => ({
  ...detail,
  cost: has(PERMISSIONS.showCost) ? detail.cost : null,
  abilities: {
    __typename: "LotteryInventoryBookAbilities",
    // 這本有跳號(記在哪家店都可以)、一張自己範圍內的未售(未鎖定)
    canCorrectSkips:
      has(PERMISSIONS.markSkipped) &&
      detail.tickets.some((ticket) => ticket.status === "skipped") &&
      detail.tickets.some(
        (ticket) =>
          ticket.operable && ticket.status === "unsold" && !ticket.locked,
      ),
    canMarkSkips:
      has(PERMISSIONS.markSkipped) &&
      detail.book.pendingSkipCount > 0 &&
      detail.tickets.some(
        (ticket) =>
          ticket.operable && ticket.status === "unsold" && !ticket.locked,
      ),
    canRecover: has(PERMISSIONS.recover),
    bookOpened: detail.book.state !== "unopened",
    canScrap: has(PERMISSIONS.scrap),
    canShowCost: has(PERMISSIONS.showCost),
    canFixOpening: has(PERMISSIONS.opening) && detail.book.source === "opening",
  },
});
