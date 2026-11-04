import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  CHECKOUT_STOCKTAKE_MODES,
  type CheckoutStocktakeMode,
  STORE_PERMISSIONS,
} from "@repo/domain/project/lottery";
import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";
import type { LotteryCheckoutStocktakeRefFieldsFragment } from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { FormControlLabel } from "@repo/ui/form-control-label";
import { useBreakpointDown } from "@repo/ui/media-query";
import { Radio, RadioGroup } from "@repo/ui/radio";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { ReasonFields } from "@/components/project/lottery/ReasonFields/ReasonFields";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import type { RedemptionFlow } from "../redemption/useRedemptionFlow";
import { RescanEnterNotice } from "../rescan/RescanEnterNotice";
import { rescansToNotice } from "../rescan/rescan-model";
import { useRescanBlocks } from "../rescan/useRescanBlocks";
import { StocktakeCountStep } from "../stocktake/StocktakeCountStep";
import { StocktakeReviewStep } from "../stocktake/StocktakeReviewStep";
import {
  ResumeSessionDialog,
  StocktakeSessionNotices,
} from "../stocktake/StocktakeSessionNotices";
import { useBlockedText } from "../stocktake/session-text";
import { type SheetCashPoint, unhandledOf } from "../stocktake/stocktake-model";
import { countReviewPropsOf } from "../stocktake/useCountGroupActions";
import type { CheckoutWizard } from "./useCheckoutWizard";

/** 盤點步驟要的精靈狀態(交班精靈 `useCheckoutWizard`、日結精靈 `useDailyCloseWizard` 共用)。 */
export type StocktakeChoiceFlow = Pick<
  CheckoutWizard,
  | "stocktakeMode"
  | "skipReason"
  | "setSkipReason"
  | "stocktake"
  | "session"
  | "stocktakeReviewed"
  | "next"
> & {
  setStocktakeMode: (mode: CheckoutStocktakeMode) => void;
  /** 日結第 ② 步選了「這次做補點編號」(張數店規格 13.2;交班沒有) */
  renumber?: boolean;
  chooseRenumber?: () => void;
};

export interface CheckoutStocktakeStepProps {
  orgId: string;
  /** 盤點的範圍:交班 = 那個收銀點;日結 = 全店(null) */
  scopeCashPointId: string | null;
  /** 可以沿用的盤點;沒有 = null */
  reusable: LotteryCheckoutStocktakeRefFieldsFragment | null;
  canSkipStocktake: boolean;
  flow: StocktakeChoiceFlow;
  /** 盤點頁的 [補登兌獎](沿用兌獎視窗) */
  redemption: RedemptionFlow;
  /** 標題與「現在盤點」的說明(日結:「② 全店盤點」「盤全店…」);不給 = 交班的文字 */
  texts?: { title: string; newHint: string };
  /** 日結第 ② 步的「這次做補點編號」(張數店與轉換中;Figma CS-13a);不給 = 沒有這個選項 */
  renumberOption?: { available: boolean; monthEndWarning: boolean };
}

/** 單選鈕的值:三種盤點方式 + 日結的「這次做補點編號」。 */
const RENUMBER_CHOICE = "renumber";

const isMode = (value: string): value is CheckoutStocktakeMode =>
  (CHECKOUT_STOCKTAKE_MODES as readonly string[]).includes(value);

/** 一個盤點方式(單選鈕 + 說明)。 */
const ModeOption = ({
  mode,
  label,
  hint,
  disabled = false,
}: {
  mode: CheckoutStocktakeMode | typeof RENUMBER_CHOICE;
  label: string;
  hint: string;
  disabled?: boolean;
}) => (
  <Box>
    <FormControlLabel
      value={mode}
      control={<Radio />}
      label={label}
      disabled={disabled}
    />
    <Typography variant="body2" color="textSecondary" sx={{ pl: 4, mt: -0.5 }}>
      {hint}
    </Typography>
  </Box>
);

/** 現在盤點:嵌入盤點頁(點格子 / 掃描 → 差異核對)。 */
const CountingArea = ({
  orgId,
  scopeCashPointId,
  flow,
  redemption,
}: CheckoutStocktakeStepProps) => {
  const t = useTranslations("admin.lotteryStore.checkout.stocktake");
  const { hasPermission } = usePermissions();
  const isNarrow = useBreakpointDown("md");
  const { stocktake, session } = flow;
  const { sheet, state, review } = stocktake;
  if (sheet === null || state === null || session.blocked !== null) {
    return null;
  }
  const openRedeem = (point: SheetCashPoint) => {
    if (point.shift != null) {
      redemption.openRedeem({
        orgId,
        shiftId: point.shift.id,
        cashPointName: point.name,
        expectedCash: point.shift.expectedCash ?? 0,
      });
    }
  };
  if (stocktake.step === "count") {
    return (
      <StocktakeCountStep
        flow={stocktake}
        sheet={sheet}
        state={state}
        scopeCashPointId={scopeCashPointId}
        isNarrow={isNarrow}
        onRedeem={hasPermission(STORE_PERMISSIONS.redeem) ? openRedeem : null}
        canConfirmLost={hasPermission(STORE_PERMISSIONS.confirmLost)}
      />
    );
  }
  return (
    <Stack spacing={2}>
      {flow.stocktakeReviewed ? (
        <Alert severity="success">{t("reviewed")}</Alert>
      ) : null}
      <StocktakeReviewStep
        review={review}
        state={state}
        storeName={sheet.orgName}
        cashPoints={sheet.cashPoints}
        canBackfill={hasPermission(STORE_PERMISSIONS.sell)}
        isBackfilling={stocktake.isBackfilling}
        onBackfill={stocktake.runBackfill}
        onChoose={stocktake.choose}
        onRecount={stocktake.recount}
        onBack={() => {
          stocktake.setStep("count");
        }}
        onSubmit={flow.next}
        notice={stocktake.notice}
        onClearStale={
          stocktake.staleNos.length > 0 ? stocktake.clearStale : null
        }
        unhandled={review === null ? 0 : unhandledOf(review, state)}
        lostReady
        canSubmit={flow.stocktakeReviewed}
        count={countReviewPropsOf(stocktake)}
      />
    </Stack>
  );
};

/**
 * 交班精靈第 ① 步 盤點(規格 6.9;Figma ST-17a):沿用 30 分鐘內的盤點 / 現在盤點(嵌入盤點頁,只盤這個收銀點)/
 * 跳過(`store.skip-stocktake`,原因必填)。現在盤點要做完差異核對才能到下一步。
 */
export const CheckoutStocktakeStep = (props: CheckoutStocktakeStepProps) => {
  const { flow, texts } = props;
  // 選「現在盤點」時有全店重刷進行中 → 先跳 8.5a 的提醒(只列自己這台;只提醒、不擋;Figma ST-16-2)
  const blocks = useRescanBlocks(props.orgId);
  const rescanNotices = rescansToNotice(blocks.rescans, props.scopeCashPointId);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const t = useTranslations("admin.lotteryStore.checkout.stocktake");
  const temporal = useTemporalText();
  const reusable = props.reusable;
  const reuseHint =
    reusable === null
      ? t("noReusable")
      : t("reuseDetail", {
          time:
            temporal(reusable.startedAt, "monthDayTime").split(" ").at(-1) ??
            "",
          scope: reusable.scopeName ?? t("wholeStore"),
          count: reusable.diffCount,
        });
  // 張數店與轉換中不能跳過(有 store.skip-stocktake 也不顯示;api 回 canSkipStocktake = false;張數店規格 13.2、Figma CS-12)
  const canSkip = props.canSkipStocktake;
  const { session } = flow;
  const blockedText = useBlockedText();
  return (
    <Stack spacing={2}>
      <Card sx={{ px: { xs: 2, sm: 3 }, py: 2.5 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle1">
            {texts?.title ?? t("title")}
          </Typography>
          {props.renumberOption?.monthEndWarning === true ? (
            <Alert severity="warning">{t("renumberMonthEnd")}</Alert>
          ) : null}
          <RadioGroup
            aria-label={texts?.title ?? t("title")}
            value={flow.renumber === true ? RENUMBER_CHOICE : flow.stocktakeMode}
            onChange={(event) => {
              const next = event.target.value;
              if (next === RENUMBER_CHOICE) {
                flow.chooseRenumber?.();
                return;
              }
              if (!isMode(next)) {
                return;
              }
              if (next === "new" && rescanNotices.length > 0) {
                setNoticeOpen(true);
                return;
              }
              flow.setStocktakeMode(next);
            }}
          >
            <ModeOption
              mode="reuse"
              label={t("reuse")}
              hint={reuseHint}
              disabled={reusable === null}
            />
            <ModeOption
              mode="new"
              label={t("new")}
              hint={texts?.newHint ?? t("newHint")}
            />
            {props.renumberOption?.available === true ? (
              <ModeOption
                mode={RENUMBER_CHOICE}
                label={t("renumber")}
                hint={t("renumberHint")}
              />
            ) : null}
            {/* ST-17a-2a 選現在盤點被擋:誰、幾點開始、剩幾分鐘;店長 [結束這個盤點] */}
            {flow.stocktakeMode === "new" && session.blocked !== null ? (
              <Alert
                severity="warning"
                sx={{ ml: 4 }}
                action={
                  session.blocked.canEnd ? (
                    <Button
                      size="small"
                      variant="text"
                      color="error"
                      disabled={session.isEnding}
                      onClick={session.endBlocked}
                    >
                      {t("endSession")}
                    </Button>
                  ) : undefined
                }
              >
                {blockedText(session.blocked)}
              </Alert>
            ) : null}
            {canSkip ? (
              <ModeOption mode="skip" label={t("skip")} hint={t("skipHint")} />
            ) : null}
          </RadioGroup>
          {flow.stocktakeMode === "skip" ? (
            <Box sx={{ maxWidth: 480 }}>
              <ReasonFields
                categoryKey={LOTTERY_FIELD_CATEGORY_KEYS.skipStocktakeReason}
                label={t("skipReason")}
                value={flow.skipReason}
                onChange={flow.setSkipReason}
                invalid={[]}
              />
            </Box>
          ) : null}
        </Stack>
      </Card>
      {flow.stocktakeMode === "new" && session.blocked === null ? (
        <StocktakeSessionNotices link={session} />
      ) : null}
      {flow.stocktakeMode === "new" ? <CountingArea {...props} /> : null}
      <RescanEnterNotice
        notices={rescanNotices}
        open={noticeOpen}
        onCancel={() => {
          setNoticeOpen(false);
        }}
        onContinue={() => {
          setNoticeOpen(false);
          flow.setStocktakeMode("new");
        }}
      />
      {/* ST-17a-2b 重新整理後 [繼續] [放棄] */}
      <ResumeSessionDialog
        session={
          flow.stocktakeMode === "new"
            ? (session.resumable ?? session.own)
            : null
        }
        isPending={session.isStarting || session.isEnding}
        onResume={session.resume}
        onAbandon={(target) => {
          void session.abandon(target).then(() => {
            session.startNew();
          });
        }}
      />
    </Stack>
  );
};
