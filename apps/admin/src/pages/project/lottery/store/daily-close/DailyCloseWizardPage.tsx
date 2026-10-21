import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  DAILY_CLOSE_STEPS,
  type DailyCloseDraft,
  type DailyCloseStep,
  STORE_BOARD_KEY,
  STORE_KEY,
  parseDailyCloseDraft,
} from "@repo/domain/project/lottery";
import {
  useLotteryCheckoutQuery,
  useLotteryDailyCloseWizardQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Stepper } from "@repo/ui/stepper";
import { Typography } from "@repo/ui/typography";

import { useFormModuleAccess } from "@/components/base/form-engine/FormModulePages/useFormModuleAccess";
import { useAdminErrorText } from "@/hooks/base/useAdminErrorText";
import { useFormDraft } from "@/hooks/base/useFormDraft";
import { useFormSubmission } from "@/hooks/base/useFormSubmission";
import { useRealtimeBoard } from "@/hooks/base/useRealtime";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useUrlState } from "@/hooks/base/useUrlState";
import type { ModulePageProps } from "@/lib/base/module-tree";

import { CheckoutStocktakeStep } from "../checkout/CheckoutStocktakeStep";
import { CHECKOUT_CONFIRM_FORM_KEY } from "../checkout/checkout-keys";
import { stepStatusOf } from "../checkout/checkout-text";
import { useRedemptionFlow } from "../redemption/useRedemptionFlow";
import {
  DailyCloseBankStep,
  DailyCloseConfirmStep,
  DailyCloseVaultStep,
} from "./DailyCloseCashSteps";
import { DailyCloseShiftsStep } from "./DailyCloseShiftsStep";
import { DAILY_CLOSE_PREFILL } from "./daily-close-keys";
import {
  type DailyCloseWizardData,
  useDailyCloseWizard,
} from "./useDailyCloseWizard";

const textSchema = z.string().default("");

/** 送出後與 [取消]:回店面管理(列表頁殼)或那張申請的檢視頁。 */
const useLeave = () => {
  const navigate = useNavigate();
  const tabHref = useRouteTabHref();
  const access = useFormModuleAccess(STORE_KEY);
  return {
    toList: () => {
      if (access.listRoute !== null) {
        void navigate(tabHref(access.listRoute));
      }
    },
    toView: (id: string) => {
      if (access.viewRoute !== null) {
        void navigate(`${access.viewRoute}/${id}`);
      }
    },
  };
};

type DailyCloseWizardFlow = ReturnType<typeof useDailyCloseWizard>;

interface WizardBodyProps {
  wizard: DailyCloseWizardData;
  initialDraft: DailyCloseDraft | null;
  notice?: string | null;
  submitError: string | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: (
    values: NonNullable<ReturnType<DailyCloseWizardFlow["valuesOf"]>>,
  ) => Promise<boolean>;
}

/**
 * 日結精靈本體(規格 6.0、6.10;Figma ST-21–25b):頁首「日結 · 分店 [取消]」、涵蓋計算期間的提示、Stepper 五步、
 * 每一步的內容、底部 [上一步] [下一步 / 送出結帳確認申請]。步驟間的資料只在畫面上,[取消] 或重新整理不留任何資料
 * (補登兌獎、補登售出例外:立即生效)。訂閱 `board:<分店>`:各班結帳的審核狀態即時更新。
 */
const WizardBody = ({
  wizard,
  initialDraft,
  notice = null,
  submitError,
  isSubmitting,
  onCancel,
  onSubmit,
}: WizardBodyProps) => {
  const t = useTranslations("admin.lotteryStore.dailyClose");
  const temporal = useTemporalText();
  const flow = useDailyCloseWizard({ wizard, initialDraft });
  const redemption = useRedemptionFlow();
  useRealtimeBoard(STORE_BOARD_KEY, wizard.org.id);
  const isLast = flow.step === "confirm";
  const stepLabel = (step: DailyCloseStep) => t(`steps.${step}`);
  const from =
    wizard.coveredFrom == null
      ? t("page.firstClose")
      : temporal(wizard.coveredFrom, "monthDayTime");
  const to =
    wizard.coveredTo == null
      ? t("page.now")
      : temporal(wizard.coveredTo, "monthDayTime");
  // `YYYY-MM-DD`(租戶時區的日期)→「10/14」
  const gaps = wizard.gapDates.map((date) =>
    date.slice(5).split("-").map(Number).join("/"),
  );
  const submit = () => {
    const values = flow.valuesOf();
    if (values !== null) {
      void onSubmit(values);
    }
  };
  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0, overflow: "auto", pb: 2 }}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "baseline", flexWrap: "wrap" }}
      >
        <Typography variant="h6" component="h1" sx={{ flex: 1 }}>
          {t("page.title", { store: wizard.org.name })}
        </Typography>
        <Button variant="text" color="error" onClick={onCancel}>
          {t("page.cancel")}
        </Button>
      </Stack>
      <Alert severity="warning">
        {gaps.length === 0
          ? t("page.period", { from, to })
          : t("page.periodWithGaps", { from, to, gaps: gaps.join("、") })}
      </Alert>
      {notice === null ? null : <Alert severity="info">{notice}</Alert>}
      <Stepper
        aria-label={t("page.stepperAria")}
        steps={DAILY_CLOSE_STEPS.map((step, index) => ({
          key: step,
          label: stepLabel(step),
          status: stepStatusOf(index, flow.stepIndex),
        }))}
        progressText={({ current, total }) =>
          t("page.progress", { current, total, label: stepLabel(flow.step) })
        }
      />
      {flow.step === "shifts" ? (
        <DailyCloseShiftsStep wizard={wizard} flow={flow} />
      ) : null}
      {flow.step === "stocktake" ? (
        <CheckoutStocktakeStep
          orgId={wizard.org.id}
          scopeCashPointId={null}
          reusable={wizard.reusableStocktake ?? null}
          canSkipStocktake={wizard.canSkipStocktake}
          flow={flow}
          redemption={redemption}
          texts={{
            title: t("stocktake.title"),
            newHint: t("stocktake.newHint"),
          }}
        />
      ) : null}
      {flow.step === "vault" ? (
        <DailyCloseVaultStep wizard={wizard} flow={flow} />
      ) : null}
      {flow.step === "bank" ? (
        <DailyCloseBankStep wizard={wizard} flow={flow} />
      ) : null}
      {flow.step === "confirm" ? (
        <DailyCloseConfirmStep wizard={wizard} flow={flow} />
      ) : null}
      {submitError === null ? null : (
        <Alert severity="error">{submitError}</Alert>
      )}
      <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end" }}>
        <Button
          variant="outlined"
          disabled={flow.stepIndex === 0 || isSubmitting}
          onClick={flow.back}
        >
          {t("page.back")}
        </Button>
        <Button
          variant="contained"
          disabled={!flow.canContinue || isSubmitting}
          onClick={isLast ? submit : flow.next}
        >
          {isLast ? t("page.submit") : t("page.next")}
        </Button>
      </Stack>
      {redemption.element}
    </Stack>
  );
};

/**
 * 日結(結帳確認申請的新增頁,`?type=daily`;規格 6.10、8.7):`?org=` 分店(看板 [日結] 帶入)。
 * [送出] 以表單引擎建立並送出申請(類型 = 日結),結帳單與全店盤點單由掛接點在同一個交易建立。
 */
export const DailyCloseCreatePage = () => {
  const t = useTranslations("admin.lotteryStore.dailyClose");
  const { session } = useSession();
  const [orgId] = useUrlState(DAILY_CLOSE_PREFILL.org, textSchema);
  const query = useLotteryDailyCloseWizardQuery(
    session.client,
    { orgId, submissionId: null },
    { enabled: orgId !== "", retry: false },
  );
  const draftState = useFormDraft(CHECKOUT_CONFIRM_FORM_KEY);
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const leave = useLeave();
  useRouteTabItemLabel(t("page.tabLabel"));
  if (query.isError || orgId === "") {
    return <Alert severity="error">{t("page.loadFailed")}</Alert>;
  }
  const wizard = query.data?.lotteryDailyCloseWizard ?? null;
  if (wizard === null) {
    return null;
  }
  return (
    <WizardBody
      wizard={wizard}
      initialDraft={null}
      submitError={
        draftState.error === null ? null : errorText(draftState.error)
      }
      isSubmitting={draftState.isPending}
      onCancel={leave.toList}
      onSubmit={async (values) => {
        const submitted = await draftState.submit(values, []);
        if (submitted === null) {
          return false;
        }
        leave.toView(submitted.id);
        return true;
      }}
    />
  );
};

/** 已退回的日結:打開日結精靈帶入原內容(涵蓋計算期間照原本那段),修改後再送出。 */
export const DailyCloseEditPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryStore.dailyClose");
  const { session } = useSession();
  const id = routeParam ?? "";
  const submission = useFormSubmission(id);
  const detail = useLotteryCheckoutQuery(
    session.client,
    { submissionId: id },
    { enabled: id !== "", retry: false },
  );
  const orgId = detail.data?.lotteryCheckout.orgId ?? "";
  const wizardQuery = useLotteryDailyCloseWizardQuery(
    session.client,
    { orgId, submissionId: id },
    { enabled: orgId !== "", retry: false },
  );
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const leave = useLeave();
  useRouteTabItemLabel(submission.submission?.serialNo ?? t("page.tabLabel"));
  if (detail.isError || wizardQuery.isError) {
    return <Alert severity="error">{t("page.loadFailed")}</Alert>;
  }
  const checkout = detail.data?.lotteryCheckout ?? null;
  const wizard = wizardQuery.data?.lotteryDailyCloseWizard ?? null;
  if (checkout === null || wizard === null || submission.submission === null) {
    return null;
  }
  const parsed = parseDailyCloseDraft(checkout.draft);
  return (
    <WizardBody
      wizard={wizard}
      initialDraft={parsed.ok ? parsed.draft : null}
      notice={t("page.returnedHint")}
      submitError={
        submission.error === null ? null : errorText(submission.error)
      }
      isSubmitting={submission.isPending}
      onCancel={() => {
        leave.toView(id);
      }}
      onSubmit={async (values) => {
        const done = await submission.submit(values);
        if (done === null) {
          return false;
        }
        leave.toView(id);
        return true;
      }}
    />
  );
};
