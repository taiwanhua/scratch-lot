import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";

import { type FieldDef, isEmptyValue } from "@repo/domain/form";
import {
  useFormUpgradePlanQuery,
  useUpgradeFormSubmissionsMutation,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { formErrorOf } from "@/lib/base/form-engine/form-errors";

import { UpgradeConfirmStep } from "./UpgradeConfirmStep";
import { UpgradePlanStep } from "./UpgradePlanStep";
import { type UpgradeResult, UpgradeResultStep } from "./UpgradeResultStep";

export interface UpgradeDialogProps {
  formKey: string;
  /** 升級到哪一版(已發布的版本) */
  targetVersion: number;
  onClose: () => void;
  /** 升級完成(結果頁「關閉」時):版本面板與提交列表要重查 */
  onUpgraded: () => void;
}

type Step = "plan" | "confirm" | "result";

const STEP_NUMBER: Record<Step, number> = { plan: 1, confirm: 2, result: 3 };

/**
 * 將舊版資料升級到此版(只限本組織沒綁流程的表單):三步跳窗。
 *
 * 1. 各舊版本的筆數 + 補值欄位(`formUpgradePlan`;補值依欄位型別呈現,可留空)
 * 2. 確認:將升級的筆數與補值摘要
 * 3. 結果:各舊版本升級幾筆、跳過幾筆與原因(`upgradeFormSubmissions`)
 *
 * 升級 = 改綁版本 + 補值 + 重算,**不驗證**;不符新版規則的資料在下次編輯送出時才要補。
 * `clientRequestId` 在跳窗打開時產生一次,重送(網路重試)回同一個結果。
 */
export const UpgradeDialog = ({
  formKey,
  targetVersion,
  onClose,
  onUpgraded,
}: UpgradeDialogProps) => {
  const t = useTranslations("admin.forms.upgrade");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const [step, setStep] = useState<Step>("plan");
  const [fills, setFills] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<UpgradeResult | null>(null);
  const [clientRequestId] = useState(() => crypto.randomUUID());

  const planQuery = useFormUpgradePlanQuery(
    session.client,
    { formKey, targetVersion },
    { retry: false, staleTime: 0 },
  );
  const plan = planQuery.data?.formUpgradePlan;
  const fillTargets = useMemo(
    () => (plan?.fillTargets ?? []) as unknown as FieldDef[],
    [plan],
  );
  const total = (plan?.groups ?? []).reduce(
    (sum, group) => sum + group.count,
    0,
  );
  const filled = fillTargets.filter((field) => !isEmptyValue(fills[field.key]));

  const upgrade = useUpgradeFormSubmissionsMutation(
    session.client,
    useMutationFeedback({
      success: t("success"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: (payload) => {
        setResult(payload.upgradeFormSubmissions);
        setStep("result");
      },
    }),
  );

  const stepName = {
    plan: t("stepPlan"),
    confirm: t("stepConfirm"),
    result: t("stepResult"),
  }[step];

  const renderBody = () => {
    if (planQuery.isLoading) {
      return <CircularProgress size={24} aria-label={t("loading")} />;
    }
    if (planQuery.error !== null || plan === undefined) {
      return (
        <Alert severity="error">
          {tErrors(formErrorOf(planQuery.error).code)}
        </Alert>
      );
    }
    if (step === "plan") {
      return (
        <UpgradePlanStep
          formKey={formKey}
          targetVersion={targetVersion}
          plan={plan}
          fillTargets={fillTargets}
          fills={fills}
          onFillChange={(fieldKey, value) => {
            setFills((current) => ({ ...current, [fieldKey]: value }));
          }}
        />
      );
    }
    if (step === "confirm") {
      return (
        <UpgradeConfirmStep
          total={total}
          targetVersion={targetVersion}
          filled={filled}
          fills={fills}
        />
      );
    }
    return result === null ? null : <UpgradeResultStep result={result} />;
  };

  const renderActions = () => {
    if (step === "result") {
      return <Button onClick={onUpgraded}>{t("close")}</Button>;
    }
    return (
      <>
        <Button variant="text" onClick={onClose}>
          {t("cancel")}
        </Button>
        {step === "confirm" && (
          <Button
            variant="text"
            onClick={() => {
              setStep("plan");
            }}
          >
            {t("back")}
          </Button>
        )}
        {step === "plan" ? (
          <Button
            disabled={plan === undefined || total === 0}
            onClick={() => {
              setStep("confirm");
            }}
          >
            {t("next")}
          </Button>
        ) : (
          <Button
            disabled={upgrade.isPending}
            onClick={() => {
              upgrade.mutate({
                input: {
                  formKey,
                  targetVersion,
                  fills: Object.fromEntries(
                    filled.map((field) => [field.key, fills[field.key]]),
                  ),
                  clientRequestId,
                },
              });
            }}
          >
            {t("confirm")}
          </Button>
        )}
      </>
    );
  };

  return (
    <Dialog
      open
      onClose={step === "result" ? onUpgraded : onClose}
      fullWidth
      maxWidth="sm"
      title={t("title", { version: targetVersion })}
      actions={renderActions()}
    >
      <Stack spacing={2}>
        <Typography variant="caption" color="text.secondary">
          {t("steps", { step: STEP_NUMBER[step], name: stepName })}
        </Typography>
        {renderBody()}
      </Stack>
    </Dialog>
  );
};
