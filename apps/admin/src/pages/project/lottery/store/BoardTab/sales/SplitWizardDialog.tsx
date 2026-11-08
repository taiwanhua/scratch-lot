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

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";

import { moneyText } from "../../store-text";
import { SplitPlaceStep } from "./SplitPlaceStep";
import { CountStep, SkipStep } from "./SplitSkipSteps";
import { useRefreshSales } from "./sales-queries";
import {
  type SplitPlaceState,
  splitAssignmentsOf,
  splitSkipPlanOf,
} from "./split-plan";
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

/** 從沒拆過的本寫「拆本」,拆過的本再上檯面寫「上檯面」(標題、確認按鈕、成功訊息)。 */
const SPLIT_KEYS = {
  open: {
    title: "split.title",
    confirm: "split.confirm",
    success: "split.success",
  },
  reopen: {
    title: "split.titleReopen",
    confirm: "split.confirmReopen",
    success: "split.successReopen",
  },
} as const;

/** 精靈上方的兩步(① 標跳號 ② 放到哪個收銀點)。 */
const SplitStepper = ({ current }: { current: "skip" | "place" }) => {
  const { t } = useSalesText();
  const label = (step: "skip" | "place") =>
    step === "skip" ? t("split.steps.skip") : t("split.steps.place");
  return (
    <Stepper
      aria-label={t("split.stepsAria")}
      steps={[
        {
          key: "skip",
          label: label("skip"),
          status: current === "skip" ? "current" : "done",
        },
        {
          key: "place",
          label: label("place"),
          status: current === "place" ? "current" : "todo",
        },
      ]}
      progressText={({ current: index, total }) =>
        t("split.progress", { current: index, total, label: label(current) })
      }
    />
  );
};

/**
 * 拆本精靈(Figma ST-09a ① 標跳號、09b ② 全部放到本機收銀點、09c ② 分放到多個收銀點、CS-08a / 08b / 08c;規格 6.4、
 * 張數店規格 7.5):只分配這家店庫存裡未售、沒被鎖的張(拆過的本再上檯面:檯面上、已售、待查的張不列)。
 * ① 原封不動的本待標註 > 0 才出現,點滿才能 [下一步];張數店與轉換中不是原封不動的本先問手上實際有幾張,
 * 比系統少幾張就點出幾張(標跳號),多了或少太多擋下(`CountStep`);其他沒有 ①(直接從 ② 開始、不顯示 Stepper)。
 * ② 預設全部放到本機收銀點,分放時每一張都要分配到一個收銀點才能確認。拆過的本標題、按鈕寫「上檯面」。
 * 跳號的張實體不存在,不算庫存。步驟之間只放在畫面狀態,關掉不留資料。
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
  const board = useLotteryStoreBoardQuery(session.client, { orgId }).data
    ?.lotteryStoreBoard.item;
  const points = board?.cashPoints ?? [];
  const [actualText, setActualText] = useState("");
  const [step, setStep] = useState<"skip" | "place" | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [place, setPlace] = useState<SplitPlaceState>({
    mode: "all",
    allTo: local?.id ?? "",
    assigned: {},
    selected: [],
  });
  const keys = SPLIT_KEYS[card?.unopened === false ? "reopen" : "open"];
  const split = useSplitLotteryBookMutation(
    session.client,
    useMutationFeedback({
      success: t(keys.success),
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
  const ticketNos = card.tickets
    .filter(
      (ticket) =>
        ticket.status === "unsold" &&
        ticket.locationKind === "stock" &&
        !ticket.locked,
    )
    .map((ticket) => ticket.ticketNo);
  // ① 要標幾張跳號(張數店拆過的本 = 手上比系統少幾張;張數店規格 7.5)
  const plan = splitSkipPlanOf(
    board?.countMode ?? "numbered",
    card,
    ticketNos.length,
    actualText,
  );
  const current = step ?? (plan.hasSkipStep ? "skip" : "place");
  const usable = ticketNos.filter((no) => !skipped.includes(no));
  const effective: SplitPlaceState = {
    ...place,
    allTo: place.allTo === "" ? (points.at(0)?.id ?? "") : place.allTo,
  };
  const assignments = splitAssignmentsOf(usable, points, effective);
  const problem = splitPlanProblemOf(
    ticketNos,
    plan.pending,
    skipped,
    assignments,
  );
  const submit = () => {
    split.mutate({
      input: {
        orgId,
        bookId,
        skippedTicketNos: skipped,
        ...(plan.askCount &&
          plan.actualCount !== null && { actualCount: plan.actualCount }),
        assignments: assignments
          .filter((row) => row.ticketNos.length > 0)
          .map((row) => ({
            cashPointId: row.cashPointId,
            ticketNos: [...row.ticketNos],
          })),
      },
    });
  };
  const back = plan.hasSkipStep ? (
    <Button
      variant="text"
      onClick={() => {
        setStep("skip");
      }}
    >
      {t("split.previous")}
    </Button>
  ) : (
    <Button variant="text" onClick={onClose}>
      {t("sale.cancel")}
    </Button>
  );
  const actions =
    current === "skip" ? (
      <>
        <Button variant="text" onClick={onClose}>
          {t("sale.cancel")}
        </Button>
        <Button
          disabled={!plan.countReady || skipped.length !== plan.pending}
          onClick={() => {
            setStep("place");
          }}
        >
          {t("split.next")}
        </Button>
      </>
    ) : (
      <>
        {back}
        <Button disabled={problem !== null || split.isPending} onClick={submit}>
          {t(keys.confirm)}
        </Button>
      </>
    );
  const skipProps = {
    ticketNos,
    lastTicketNo: card.lastTicketNo,
    skipped,
    onChange: setSkipped,
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      fullScreen={isMobile}
      maxWidth="sm"
      title={t(keys.title, {
        code: card.gameCode,
        name: card.gameName,
        bookNo: displayBookNo(card.bookNo),
      })}
      actions={actions}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="textSecondary">
          {t("split.meta", {
            price: moneyText(card.unitPrice),
            first: card.firstTicketNo,
            last: card.lastTicketNo,
          })}
        </Typography>
        {card.unopened || plan.askCount ? null : (
          <Typography variant="body2">
            {t("split.reopenHint", { count: ticketNos.length })}
          </Typography>
        )}
        {plan.hasSkipStep ? <SplitStepper current={current} /> : null}
        {current === "skip" && plan.askCount ? (
          <CountStep
            {...skipProps}
            plan={plan}
            actualText={actualText}
            onActualChange={(text) => {
              setActualText(text);
              setSkipped([]);
            }}
          />
        ) : null}
        {current === "skip" && !plan.askCount ? (
          <SkipStep {...skipProps} pending={plan.pending} />
        ) : null}
        {current === "place" ? (
          <SplitPlaceStep
            ticketNos={ticketNos}
            skipped={skipped}
            points={points}
            localId={local?.id ?? null}
            state={effective}
            onChange={setPlace}
            assignments={assignments}
          />
        ) : null}
      </Stack>
    </Dialog>
  );
};
