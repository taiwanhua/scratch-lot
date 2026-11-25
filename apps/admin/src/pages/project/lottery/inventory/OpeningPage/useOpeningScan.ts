import { useState } from "react";
import { useTranslations } from "use-intl";

import { useLotteryOpeningScanQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";

import {
  type OpeningCard,
  openingCardOf,
  openingScanOutcomeOf,
} from "./opening-plan";
import { useOpeningErrorText } from "./useOpeningErrorText";

/** 刷條碼列下方的訊息;`bookId` = 附 [本的詳情]。 */
export interface OpeningScanMessage {
  severity: "warning" | "error";
  text: string;
  bookId?: string;
}

/**
 * 期初建檔頁刷到一張(規格 3.1、3.2):問 api 這本是哪款遊戲、能不能建 → 開本卡(停售的遊戲提示但照開),
 * 或在刷條碼列下方寫擋下的原因(已在系統裡附 [本的詳情]、在進貨單上帶單號)。
 */
export const useOpeningScan = ({
  orgId,
  fallbackGameId,
  onBook,
}: {
  orgId: string;
  fallbackGameId: string | null;
  onBook: (card: OpeningCard) => void;
}) => {
  const t = useTranslations("admin.lotteryInventory.opening");
  const { session } = useSession();
  const errorText = useOpeningErrorText();
  const [message, setMessage] = useState<OpeningScanMessage | null>(null);
  const fail = (next: OpeningScanMessage) => {
    setMessage(next);
    return false;
  };

  const scan = async (code: string): Promise<boolean> => {
    if (orgId === "") {
      return false;
    }
    let result;
    try {
      result = await useLotteryOpeningScanQuery.fetcher(session.client, {
        input: { orgId, code },
      })();
    } catch (error) {
      return fail({ severity: "error", text: errorText(error) });
    }
    const outcome = openingScanOutcomeOf(
      result.lotteryOpeningScan,
      fallbackGameId,
    );
    switch (outcome.kind) {
      case "book": {
        onBook(
          openingCardOf(outcome.game, outcome.bookNo, outcome.topTicketNo),
        );
        setMessage(
          outcome.game.discontinued
            ? { severity: "warning", text: t("discontinued") }
            : null,
        );
        return true;
      }
      case "exists": {
        return fail({
          severity: "error",
          text: t("scanErrors.exists"),
          bookId: outcome.bookId,
        });
      }
      case "on_purchase": {
        return fail({
          severity: "error",
          text: t("scanErrors.on_purchase", { serialNo: outcome.serialNo }),
        });
      }
      default: {
        return fail({
          severity: "error",
          text: t(`scanErrors.${outcome.kind}`),
        });
      }
    }
  };
  return { scan, message, setMessage };
};
