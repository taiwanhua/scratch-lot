import { HttpResponse } from "msw";

import { INVENTORY_PERMISSIONS } from "@repo/domain/project/lottery";
import type { UndoLotteryScrapMutationVariables } from "@repo/graphql";

import { api } from "../../server";

export type UndoScrapInput = UndoLotteryScrapMutationVariables["input"];

/**
 * 撤銷報廢的假 api(張數店規格 7.8;`inventoryWorld` 的一部分):報廢 → 未售、位置不變;
 * 回扣回的損失(每張 184,有 `show-cost` 才回)。
 */
export const undoScrapHandler = ({
  inputs,
  forbidden,
  has,
  updateTickets,
}: {
  inputs: { undoScrap: UndoScrapInput[] };
  /** 沒有這個權限 → 回 FORBIDDEN 的回應;有 → null */
  forbidden: (permission: string) => Response | null;
  has: (permission: string) => boolean;
  updateTickets: (
    ticketIds: readonly string[],
    patch: (status: string) => string,
  ) => void;
}) =>
  api.mutation("UndoLotteryScrap", ({ variables }) => {
    const { input } = variables as UndoLotteryScrapMutationVariables;
    const denied = forbidden(INVENTORY_PERMISSIONS.scrap);
    if (denied) return denied;
    inputs.undoScrap.push(input);
    const ids = input.tickets.map((item) => item.ticketId);
    updateTickets(ids, () => "unsold");
    return HttpResponse.json({
      data: {
        undoLotteryScrap: {
          __typename: "LotteryInventoryActionPayload",
          count: ids.length,
          lossCost: has(INVENTORY_PERMISSIONS.showCost)
            ? ids.length * 184
            : null,
        },
      },
    });
  });
