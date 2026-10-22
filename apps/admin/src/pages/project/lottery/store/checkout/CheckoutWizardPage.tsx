import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { z } from "zod";

import {
  type CheckoutDraft,
  STORE_KEY,
  parseCheckoutDraft,
} from "@repo/domain/project/lottery";
import {
  useLotteryCheckoutQuery,
  useLotteryCheckoutWizardQuery,
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
import { usePermissions } from "@/hooks/base/usePermissions";
import { useRouteTabHref } from "@/hooks/base/useRouteTabHref";
import { useRouteTabItemLabel } from "@/hooks/base/useRouteTabItemLabel";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useUrlState } from "@/hooks/base/useUrlState";
import type { ModulePageProps } from "@/lib/base/module-tree";
import { PRINT_BUTTON_PERMISSIONS } from "@/lib/base/print-button";

import { useRedemptionFlow } from "../redemption/useRedemptionFlow";
import { CheckoutConfirmStep } from "./CheckoutConfirmStep";
import { CheckoutDrawerStep } from "./CheckoutDrawerStep";
import { CheckoutRedemptionStep } from "./CheckoutRedemptionStep";
import { CheckoutStocktakeStep } from "./CheckoutStocktakeStep";
import {
  CHECKOUT_CONFIRM_FORM_KEY,
  CHECKOUT_PREFILL,
  CHECKOUT_STEPS,
} from "./checkout-keys";
import { stepStatusOf } from "./checkout-text";
import {
  type CheckoutWizardData,
  useCheckoutWizard,
} from "./useCheckoutWizard";

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

interface WizardBodyProps {
  wizard: CheckoutWizardData;
  initialDraft: CheckoutDraft | null;
  notice?: string | null;
  submitError: string | null;
  isSubmitting: boolean;
  onCancel: () => void;
  /** 回 true = 已送出 */
  onSubmit: (
    values: NonNullable<ReturnType<CheckoutWizard["valuesOf"]>>,
  ) => Promise<boolean>;
}

type CheckoutWizard = ReturnType<typeof useCheckoutWizard>;

/**
 * 交班精靈本體(規格 6.0、6.9;Figma ST-17a / 17b / 18 / 19a / 19b):頁首「交班結帳 · 收銀點 負責人 · 開班時間 [取消]」、
 * Stepper 四步、每一步的內容、底部 [上一步] [下一步 / 送出]。步驟間的資料只在畫面上,[取消] 或重新整理不留任何資料;
 * 補登兌獎例外(立即生效,取消精靈也不會退回)。
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
  const t = useTranslations("admin.lotteryStore.checkout");
  const temporal = useTemporalText();
  const flow = useCheckoutWizard({ wizard, initialDraft });
  // 有收據機(`api.printing.print`)→ 送出後自動印交班結帳單(`CheckoutReceiptEffect`),按鈕寫明
  const { hasPermission } = usePermissions();
  const submitKey = hasPermission(PRINT_BUTTON_PERMISSIONS.print)
    ? "page.submitAndPrint"
    : "page.submit";
  const redemption = useRedemptionFlow();
  const isLast = flow.step === "confirm";
  const stepLabel = (step: (typeof CHECKOUT_STEPS)[number]) =>
    t(`steps.${step}`);
  const submit = () => {
    const values = flow.valuesOf();
    if (values !== null) {
      void onSubmit(values);
    }
  };
  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0, overflow: "auto", pb: 2 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ alignItems: { sm: "baseline" } }}
      >
        <Typography variant="h6" component="h1">
          {t("page.title", { cashPoint: wizard.shift.cashPoint.name })}
        </Typography>
        <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
          {t("page.meta", {
            name: wizard.shift.openedBy.name,
            time:
              temporal(wizard.shift.openedAt, "monthDayTime")
                .split(" ")
                .at(-1) ?? "",
          })}
        </Typography>
        <Button variant="text" color="error" onClick={onCancel}>
          {t("page.cancel")}
        </Button>
      </Stack>
      {notice === null ? null : <Alert severity="info">{notice}</Alert>}
      {wizard.canSubmit ? null : (
        <Alert severity="warning">{t("page.cannotSubmit")}</Alert>
      )}
      <Stepper
        aria-label={t("page.stepperAria")}
        steps={CHECKOUT_STEPS.map((step, index) => ({
          key: step,
          label: stepLabel(step),
          status: stepStatusOf(index, flow.stepIndex),
        }))}
        progressText={({ current, total }) =>
          t("page.progress", {
            current,
            total,
            label: stepLabel(flow.step),
          })
        }
      />
      {flow.step === "stocktake" ? (
        <CheckoutStocktakeStep
          orgId={wizard.shift.orgId}
          scopeCashPointId={wizard.shift.cashPoint.id}
          reusable={wizard.reusableStocktake ?? null}
          canSkipStocktake={wizard.canSkipStocktake}
          flow={flow}
          redemption={redemption}
        />
      ) : null}
      {flow.step === "redemption" ? (
        <CheckoutRedemptionStep wizard={wizard} redemption={redemption} />
      ) : null}
      {flow.step === "drawer" ? (
        <CheckoutDrawerStep
          wizard={wizard}
          flow={flow}
          redemption={redemption}
        />
      ) : null}
      {flow.step === "confirm" ? (
        <CheckoutConfirmStep wizard={wizard} flow={flow} />
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
          {isLast ? t(submitKey) : t("page.next")}
        </Button>
      </Stack>
      {redemption.element}
    </Stack>
  );
};

/**
 * 交班結帳(結帳確認申請的新增頁;規格 6.9、8.7):`?shift=` 那一班(看板 [交班結帳] 帶入)、`?org=` 分店。
 * [送出] 以表單引擎建立並送出申請,結帳單與盤點單由掛接點在同一個交易建立。
 */
export const CheckoutCreatePage = () => {
  const t = useTranslations("admin.lotteryStore.checkout");
  const { session } = useSession();
  const [shiftId] = useUrlState(CHECKOUT_PREFILL.shift, textSchema);
  const query = useLotteryCheckoutWizardQuery(
    session.client,
    { shiftId },
    { enabled: shiftId !== "", retry: false },
  );
  const draftState = useFormDraft(CHECKOUT_CONFIRM_FORM_KEY);
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const leave = useLeave();
  useRouteTabItemLabel(t("page.tabLabel"));
  if (query.isError || shiftId === "") {
    return <Alert severity="error">{t("page.loadFailed")}</Alert>;
  }
  const wizard = query.data?.lotteryCheckoutWizard ?? null;
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

/**
 * 已退回的結帳確認申請:打開精靈帶入原內容,修改後再送出(規格 8.7「退回修正跟著更新」)。
 */
export const CheckoutEditPage = ({ routeParam }: ModulePageProps) => {
  const t = useTranslations("admin.lotteryStore.checkout");
  const { session } = useSession();
  const id = routeParam ?? "";
  const submission = useFormSubmission(id);
  const detail = useLotteryCheckoutQuery(
    session.client,
    { submissionId: id },
    { enabled: id !== "", retry: false },
  );
  const shiftId = detail.data?.lotteryCheckout.shiftId ?? "";
  const wizardQuery = useLotteryCheckoutWizardQuery(
    session.client,
    { shiftId },
    { enabled: shiftId !== "", retry: false },
  );
  const errorText = useAdminErrorText("admin.formEngine.errors");
  const leave = useLeave();
  useRouteTabItemLabel(submission.submission?.serialNo ?? t("page.tabLabel"));
  if (detail.isError || wizardQuery.isError) {
    return <Alert severity="error">{t("page.loadFailed")}</Alert>;
  }
  const checkout = detail.data?.lotteryCheckout ?? null;
  const wizard = wizardQuery.data?.lotteryCheckoutWizard ?? null;
  if (checkout === null || wizard === null || submission.submission === null) {
    return null;
  }
  const parsed = parseCheckoutDraft(checkout.draft);
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
