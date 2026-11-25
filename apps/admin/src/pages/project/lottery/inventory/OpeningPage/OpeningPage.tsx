import { useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { DEFAULT_TENANT_TIMEZONE, formatTemporal } from "@repo/domain/form";
import { displayBookKey } from "@repo/domain/project/lottery";
import {
  type LotteryStoreOpeningFieldsFragment,
  useCreateLotteryOpeningBookMutation,
  useLotteryStoreOpeningQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Stack } from "@repo/ui/stack";

import { useMe } from "@/hooks/base/useMe";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";
import { readLocalCashPoint } from "@/lib/project/lottery/local-cash-point";

import { OpeningBookCard } from "./OpeningBookCard";
import { OpeningBookList } from "./OpeningBookList";
import { OpeningConfirmDialog } from "./OpeningConfirmDialog";
import { OpeningPageHeader } from "./OpeningPageHeader";
import { OpeningScanSection } from "./OpeningScanSection";
import { OpeningVoidDialog } from "./OpeningVoidDialog";
import {
  OPENING_STOCK,
  type OpeningCard,
  openingCardPlanOf,
} from "./opening-plan";
import { useOpeningErrorText } from "./useOpeningErrorText";
import { useOpeningScan } from "./useOpeningScan";
import { useOpeningSummary } from "./useOpeningSummary";
import { useRefreshOpening } from "./useRefreshOpening";

type OpeningBook = LotteryStoreOpeningFieldsFragment["books"][number];

const orgSchema = z.string().default("");

/**
 * 期初建檔頁(隱藏頁 `inventory.opening-page`,`?org=`;Figma OP-01a–c、OP-04;期初建檔規格 3):選分店 → 提示先登記先賣的本
 * → 刷條碼列(沿用進貨單:正面條碼的遊戲 + 輸入欄)→ 本卡(`OpeningBookCard`)→ [建檔] 確認框 → 下方已建檔的本
 * (`OpeningBookList`,[作廢])。已結束的店只顯示「已結束(日期 誰)」與清單,不能操作。
 */
export const OpeningPage = () => {
  const t = useTranslations("admin.lotteryInventory.opening");
  const { session } = useSession();
  const me = useMe();
  const timezone = useTenantTimezone() ?? DEFAULT_TENANT_TIMEZONE;
  const errorText = useOpeningErrorText();
  const [orgParam, setOrgParam] = useUrlState("org", orgSchema);
  const orgId = orgParam === "" ? (me.data?.me.currentOrg?.id ?? "") : orgParam;
  const [card, setCard] = useState<OpeningCard | null>(null);
  const [fallbackGameId, setFallbackGameId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [voiding, setVoiding] = useState<OpeningBook | null>(null);
  useRouteTabItemLabel(t("tabLabel"));

  const variables = { orgId };
  const query = useLotteryStoreOpeningQuery(session.client, variables, {
    enabled: orgId !== "",
    retry: false,
  });
  const opening = query.data?.lotteryStoreOpening.item ?? null;
  const localId = orgId === "" ? null : readLocalCashPoint(orgId);
  const places = [
    ...(opening?.cashPoints ?? []),
    { id: OPENING_STOCK, name: t("card.place.stock") },
  ];
  const summaryOf = useOpeningSummary(places);
  const { scan, message, setMessage } = useOpeningScan({
    orgId,
    fallbackGameId,
    onBook: setCard,
  });
  const plan = card === null ? null : openingCardPlanOf(card, places, localId);
  const bookKey =
    card === null ? "" : displayBookKey(card.game.gameCode, card.bookNo);

  const refresh = useRefreshOpening();
  const create = useCreateLotteryOpeningBookMutation(
    session.client,
    useMutationFeedback({
      success: t("success", { key: bookKey }),
      error: errorText,
      onSuccess: () => {
        refresh();
        setCard(null);
        setMessage(null);
        setIsConfirming(false);
      },
      onError: () => {
        setIsConfirming(false);
        refresh();
      },
    }),
  );
  const submit = () => {
    if (card === null || plan?.last == null) {
      return;
    }
    create.mutate({
      input: {
        orgId,
        gameId: card.game.gameId,
        bookNo: card.bookNo,
        lastTicketNo: plan.last,
        rate: card.rate,
        soldTicketNos: card.sold,
        skippedTicketNos: card.skipped,
        placements: plan.placements.map((placement) => ({
          cashPointId: placement.cashPointId,
          ticketNos: [...placement.ticketNos],
        })),
      },
    });
  };

  const isClosed = opening?.closed === true;
  const closedText = (item: LotteryStoreOpeningFieldsFragment) =>
    t("closed", {
      date:
        item.closedAt == null
          ? ""
          : formatTemporal(item.closedAt, { type: "monthDay", timezone }),
      by: item.closedBy?.name ?? "",
    });
  const canOpen = opening?.canOpen === true;

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0, overflow: "auto", pb: 2 }}>
      <OpeningPageHeader
        orgId={orgId}
        onOrgChange={(next) => {
          setOrgParam(next);
          setCard(null);
          setMessage(null);
        }}
      />
      {orgId === "" ? <Alert severity="info">{t("pickOrg")}</Alert> : null}
      {query.error === null ? null : (
        <Alert severity="error">{errorText(query.error)}</Alert>
      )}
      {opening !== null && isClosed ? (
        <Alert severity="info">{closedText(opening)}</Alert>
      ) : null}
      {canOpen ? (
        <OpeningScanSection
          onScan={scan}
          message={message}
          disabled={create.isPending}
          fallbackGameId={fallbackGameId}
          onFallbackGameChange={setFallbackGameId}
        />
      ) : null}
      {canOpen && card !== null && plan !== null ? (
        <OpeningBookCard
          card={card}
          plan={plan}
          onChange={setCard}
          places={places}
          localId={localId}
          canShowCost={opening.canShowCost}
          onCancel={() => {
            setCard(null);
            setMessage(null);
          }}
          onSubmit={() => {
            setIsConfirming(true);
          }}
        />
      ) : null}
      {opening === null ? null : (
        <OpeningBookList
          books={opening.books}
          canOpen={canOpen}
          onVoid={setVoiding}
        />
      )}
      {isConfirming && card !== null && plan !== null ? (
        <OpeningConfirmDialog
          bookKey={bookKey}
          summary={summaryOf(card, plan)}
          isPending={create.isPending}
          onClose={() => {
            setIsConfirming(false);
          }}
          onConfirm={submit}
        />
      ) : null}
      {voiding === null ? null : (
        <OpeningVoidDialog
          book={voiding}
          onClose={() => {
            setVoiding(null);
          }}
        />
      )}
    </Stack>
  );
};
