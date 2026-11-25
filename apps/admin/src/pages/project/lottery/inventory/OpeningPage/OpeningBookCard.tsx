import { useTranslations } from "use-intl";

import { displayBookNo, purchaseAmountOf } from "@repo/domain/project/lottery";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Stack } from "@repo/ui/stack";
import { Stepper } from "@repo/ui/stepper";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { RateInput } from "@/components/project/lottery/BookGroupList/RateInput";
import { SkipStep } from "@/components/project/lottery/SplitSteps/SkipStep";
import { SplitPlaceStep } from "@/components/project/lottery/SplitSteps/SplitPlaceStep";
import { TicketGrid } from "@/components/project/lottery/TicketGrid/TicketGrid";

import { moneyText } from "../inventory-config";
import {
  type OpeningCard,
  type OpeningCardPlan,
  type OpeningPlace,
  type OpeningStep,
  withLastText,
} from "./opening-plan";
import { useOpeningSummary } from "./useOpeningSummary";

export interface OpeningBookCardProps {
  card: OpeningCard;
  plan: OpeningCardPlan;
  onChange: (card: OpeningCard) => void;
  /** 收銀點 + 庫存 */
  places: readonly OpeningPlace[];
  localId: string | null;
  /** 看得到成本(`inventory.show-cost`) */
  canShowCost: boolean;
  onCancel: () => void;
  /** [建檔](開確認框) */
  onSubmit: () => void;
}

/**
 * 期初建檔頁的本卡(一次一本;Figma OP-02a–d;期初建檔規格 3.1):迄號 → ① 標導入前已賣出(已售樣式)→
 * ② 標跳號(迄號比標準張數多才有)→ ③ 分放到收銀點檯面或庫存 + 批購金額率(旁邊成本)+ 合計 + [建檔]。
 */
export const OpeningBookCard = ({
  card,
  plan,
  onChange,
  places,
  localId,
  canShowCost,
  onCancel,
  onSubmit,
}: OpeningBookCardProps) => {
  const t = useTranslations("admin.lotteryInventory.opening.card");
  const summaryOf = useOpeningSummary(places);
  const { game } = card;
  const steps: OpeningStep[] =
    plan.pending > 0 ? ["sold", "skip", "place"] : ["sold", "place"];
  const index = Math.max(0, steps.indexOf(card.step));
  const current = steps[index] ?? "sold";
  const go = (step: OpeningStep | undefined) => {
    if (step !== undefined) {
      onChange({ ...card, step });
    }
  };
  const soldSet = new Set(card.sold);
  const skippedSet = new Set(card.skipped);
  const problemText =
    plan.problem === null
      ? null
      : t(`problems.${plan.problem}`, {
          min: game.ticketsPerBook,
          count: plan.pending - card.skipped.length,
        });
  const canLeaveSkip =
    card.skipped.length === plan.pending || card.skipped.length === 0;

  return (
    <Card sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          sx={{ justifyContent: "space-between" }}
        >
          <Box>
            <Typography variant="subtitle1" color="textPrimary">
              {t("title", {
                code: game.gameCode,
                name: game.gameName,
                bookNo: displayBookNo(card.bookNo),
              })}
            </Typography>
            <Typography variant="body2" color="textSecondary">
              {t("meta", {
                price: moneyText(game.bookPrice),
                count: game.ticketsPerBook,
              })}
            </Typography>
          </Box>
          <TextField
            label={t("last")}
            size="small"
            value={card.lastText}
            error={plan.last === null}
            helperText={t("lastHelper", { min: game.ticketsPerBook })}
            onChange={(event) => {
              onChange(withLastText(card, event.target.value));
            }}
            slotProps={{ htmlInput: { inputMode: "numeric" } }}
            sx={{ width: { xs: "100%", sm: 140 } }}
          />
        </Stack>
        <Stepper
          aria-label={t("stepsAria")}
          steps={steps.map((step, position) => ({
            key: step,
            label: t(`steps.${step}`),
            status: (() => {
              if (position === index) {
                return "current";
              }
              return position < index ? "done" : "todo";
            })(),
          }))}
          progressText={({ current: at, total }) =>
            t("progress", {
              current: at,
              total,
              label: t(`steps.${current}`),
            })
          }
        />
        {current === "sold" ? (
          <Stack spacing={1.5}>
            <Typography variant="body2">{t("soldHint")}</Typography>
            <TicketGrid
              cells={plan.ticketNos.map((no) => ({
                ticketNo: no,
                state: skippedSet.has(no) ? "skipped" : "unsold",
              }))}
              selectableStates={["unsold"]}
              selected={card.sold}
              selectedLook="sold"
              onSelectedChange={(sold) => {
                onChange({ ...card, sold });
              }}
              legendItems={["unsold", "sold"]}
              labels={{ sold: t("soldLegend") }}
            />
          </Stack>
        ) : null}
        {current === "skip" ? (
          <SkipStep
            ticketNos={plan.skipCandidates}
            lastTicketNo={card.lastText}
            pending={plan.pending}
            skipped={card.skipped}
            onChange={(skipped) => {
              onChange({ ...card, skipped });
            }}
            hint={
              <Typography variant="body2">
                {t("skipHint", { last: card.lastText, count: plan.pending })}
              </Typography>
            }
          />
        ) : null}
        {current === "place" ? (
          <Stack spacing={2}>
            <SplitPlaceStep
              ticketNos={plan.ticketNos.filter((no) => !soldSet.has(no))}
              skipped={card.skipped}
              points={places}
              localId={localId}
              state={plan.place}
              onChange={(place) => {
                onChange({ ...card, place });
              }}
              assignments={plan.assignments}
              labels={{
                allTo: t("place.allTo"),
                allToField: t("place.allToField"),
                splitOption: t("place.splitOption"),
                splitHint: t("place.splitHint"),
                column: t("place.column"),
                remaining: (count) => t("place.remaining", { count }),
              }}
            />
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Typography variant="body2">{t("rate")}</Typography>
              <RateInput
                label={t("rate")}
                value={card.rate}
                isEdited={card.rate !== game.defaultRate}
                onChange={(rate) => {
                  onChange({ ...card, rate });
                }}
              />
              {canShowCost ? (
                <Typography variant="body2" color="textSecondary">
                  {t("cost", {
                    amount: moneyText(
                      purchaseAmountOf(game.bookPrice, card.rate),
                    ),
                  })}
                </Typography>
              ) : null}
            </Stack>
            <Typography variant="body1">{summaryOf(card, plan)}</Typography>
            {problemText === null ? null : (
              <Alert severity="warning">{problemText}</Alert>
            )}
          </Stack>
        ) : null}
        <Stack
          direction="row"
          spacing={1}
          sx={{ justifyContent: "flex-end", flexWrap: "wrap" }}
        >
          <Button variant="text" onClick={onCancel}>
            {t("cancel")}
          </Button>
          {index > 0 ? (
            <Button
              variant="outlined"
              onClick={() => {
                go(steps[index - 1]);
              }}
            >
              {t("previous")}
            </Button>
          ) : null}
          {current === "place" ? (
            <Button disabled={plan.problem !== null} onClick={onSubmit}>
              {t("submit")}
            </Button>
          ) : (
            <Button
              disabled={
                plan.last === null || (current === "skip" && !canLeaveSkip)
              }
              onClick={() => {
                go(steps[index + 1]);
              }}
            >
              {t("next")}
            </Button>
          )}
        </Stack>
      </Stack>
    </Card>
  );
};
