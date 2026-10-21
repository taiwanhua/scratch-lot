import { useState } from "react";

import {
  displayBookNo,
  splitPlanProblemOf,
} from "@repo/domain/project/lottery";
import {
  useLotteryStoreBoardQuery,
  useLotteryStoreBookCardQuery,
  useSplitLotteryBookMutation,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Stack } from "@repo/ui/stack";
import { Stepper } from "@repo/ui/stepper";
import { Typography } from "@repo/ui/typography";

import { TicketGrid } from "@/components/project/lottery/TicketGrid/TicketGrid";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { moneyText } from "../../store-text";
import { SplitPlaceStep } from "./SplitPlaceStep";
import { useRefreshSales } from "./sales-queries";
import { type SplitPlaceState, splitAssignmentsOf } from "./split-plan";
import { useSalesText } from "./useSalesText";

export interface SplitWizardDialogProps {
  orgId: string;
  bookId: string;
  /** 本機收銀點(「全部放到」的預設);沒設定 = 第一個收銀點 */
  local: { id: string; name: string } | null;
  onClose: () => void;
  /** 拆好了(對話框由呼叫端關) */
  onSplit: () => void;
}

const SkipStep = ({
  ticketNos,
  lastTicketNo,
  pending,
  skipped,
  onChange,
}: {
  ticketNos: readonly string[];
  lastTicketNo: string;
  pending: number;
  skipped: string[];
  onChange: (skipped: string[]) => void;
}) => {
  const { t } = useSalesText();
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2">
        {t("split.skipHint", { last: lastTicketNo, count: pending })}
      </Typography>
      <TicketGrid
        cells={ticketNos.map((no) => ({ ticketNo: no, state: "unsold" }))}
        selectableStates={["unsold"]}
        selected={skipped}
        onSelectedChange={onChange}
        legendItems={["unsold", "selected"]}
        quickSelect={false}
        maxSelected={pending}
        summary={false}
      />
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        <Typography variant="body2" color="text.secondary">
          {t("split.skipSelected")}
        </Typography>
        <Typography variant="body1">
          {t("split.skipSelectedValue", {
            count: skipped.length,
            total: pending,
            nos: skipped
              .toSorted((a, b) => a.localeCompare(b))
              .map((no) => `#${no}`)
              .join("、"),
          })}
        </Typography>
      </Stack>
    </Stack>
  );
};

/**
 * 拆本精靈(Figma ST-09a ① 標跳號、09b ② 全部放到本機收銀點、09c ② 分放到多個收銀點;規格 6.4):
 * ① 只有待標註 > 0 才出現(沒有就直接從 ② 開始、不顯示 Stepper),點滿才能 [下一步];② 預設全部放到
 * 本機收銀點,分放時每一張都要分配到一個收銀點才能 [確認拆本]。跳號的張實體不存在,不算庫存。
 * 步驟之間只放在畫面狀態,關掉不留資料。
 */
export const SplitWizardDialog = ({
  orgId,
  bookId,
  local,
  onClose,
  onSplit,
}: SplitWizardDialogProps) => {
  const { t, errorText } = useSalesText();
  const { session } = useSession();
  const refresh = useRefreshSales();
  const isMobile = useBreakpointDown("sm");
  const card = useLotteryStoreBookCardQuery(
    session.client,
    { orgId, bookId },
    { staleTime: 0 },
  ).data?.lotteryStoreBookCard.item;
  const points =
    useLotteryStoreBoardQuery(session.client, { orgId }).data?.lotteryStoreBoard
      .item.cashPoints ?? [];
  const pending = card?.pendingSkipCount ?? 0;
  const [step, setStep] = useState<"skip" | "place" | null>(null);
  const current = step ?? (pending > 0 ? "skip" : "place");
  const [skipped, setSkipped] = useState<string[]>([]);
  const [place, setPlace] = useState<SplitPlaceState>({
    mode: "all",
    allTo: local?.id ?? "",
    assigned: {},
    selected: [],
  });
  const split = useSplitLotteryBookMutation(
    session.client,
    useMutationFeedback({
      success: t("split.success"),
      error: errorText,
      onSuccess: () => {
        refresh();
        onSplit();
      },
    }),
  );

  if (card === undefined) {
    return null;
  }
  const ticketNos = card.tickets.map((ticket) => ticket.ticketNo);
  const usable = ticketNos.filter((no) => !skipped.includes(no));
  const effective: SplitPlaceState = {
    ...place,
    allTo: place.allTo === "" ? (points.at(0)?.id ?? "") : place.allTo,
  };
  const assignments = splitAssignmentsOf(usable, points, effective);
  const problem = splitPlanProblemOf(ticketNos, pending, skipped, assignments);
  const submit = () => {
    split.mutate({
      input: {
        orgId,
        bookId,
        skippedTicketNos: skipped,
        assignments: assignments
          .filter((row) => row.ticketNos.length > 0)
          .map((row) => ({
            cashPointId: row.cashPointId,
            ticketNos: [...row.ticketNos],
          })),
      },
    });
  };
  const cancel = (
    <Button variant="text" onClick={onClose}>
      {t("sale.cancel")}
    </Button>
  );
  const actions =
    current === "skip" ? (
      <>
        {cancel}
        <Button
          disabled={skipped.length !== pending}
          onClick={() => {
            setStep("place");
          }}
        >
          {t("split.next")}
        </Button>
      </>
    ) : (
      <>
        {pending > 0 ? (
          <Button
            variant="text"
            onClick={() => {
              setStep("skip");
            }}
          >
            {t("split.previous")}
          </Button>
        ) : (
          cancel
        )}
        <Button disabled={problem !== null || split.isPending} onClick={submit}>
          {t("split.confirm")}
        </Button>
      </>
    );

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={t("split.title", {
        code: card.gameCode,
        name: card.gameName,
        bookNo: displayBookNo(card.bookNo),
      })}
      actions={actions}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {t("split.meta", {
            price: moneyText(card.unitPrice),
            first: card.firstTicketNo,
            last: card.lastTicketNo,
          })}
        </Typography>
        {pending > 0 ? (
          <Stepper
            aria-label={t("split.stepsAria")}
            steps={[
              {
                key: "skip",
                label: t("split.steps.skip"),
                status: current === "skip" ? "current" : "done",
              },
              {
                key: "place",
                label: t("split.steps.place"),
                status: current === "place" ? "current" : "todo",
              },
            ]}
            progressText={({ current: index, total }) =>
              t("split.progress", {
                current: index,
                total,
                label:
                  current === "skip"
                    ? t("split.steps.skip")
                    : t("split.steps.place"),
              })
            }
          />
        ) : null}
        {current === "skip" ? (
          <SkipStep
            ticketNos={ticketNos}
            lastTicketNo={card.lastTicketNo}
            pending={pending}
            skipped={skipped}
            onChange={setSkipped}
          />
        ) : (
          <SplitPlaceStep
            ticketNos={ticketNos}
            skipped={skipped}
            points={points}
            localId={local?.id ?? null}
            state={effective}
            onChange={setPlace}
            assignments={assignments}
          />
        )}
      </Stack>
    </Dialog>
  );
};
