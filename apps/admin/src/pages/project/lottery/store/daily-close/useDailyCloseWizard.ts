import { useState } from "react";

import type { StoredValues } from "@repo/domain/form";
import {
  CHECKOUT_DENOMINATIONS,
  CHECKOUT_FIELD_KEYS,
  CHECKOUT_TYPE,
  type CheckoutStocktakeMode,
  DAILY_CLOSE_STEPS,
  type DailyCloseDraft,
  type DailyCloseStep,
  bankDepositProblemOf,
  countedTotalOf,
  isDiffReasonRequired,
  serializeDailyCloseDraft,
} from "@repo/domain/project/lottery";
import type { LotteryDailyCloseWizardQuery as WizardQuery } from "@repo/graphql";

import {
  EMPTY_REASON,
  type ReasonValue,
  missingReasonFields,
  reasonInputOf,
} from "@/components/project/lottery/ReasonFields/reason-value";

import { lostChoicesReady, unhandledOf } from "../stocktake/stocktake-model";
import { useStocktakeFlow } from "../stocktake/useStocktakeFlow";

export type DailyCloseWizardData = WizardQuery["lotteryDailyCloseWizard"];

export interface DailyCloseWizardInput {
  wizard: DailyCloseWizardData;
  /** 退回後再送出:帶入原內容 */
  initialDraft: DailyCloseDraft | null;
}

/**
 * 日結精靈的畫面狀態與規則(規格 6.0、6.10):五步、全店盤點方式(現在盤點的狀態在 `useStocktakeFlow`,範圍 = 全店)、
 * 小金庫依面額清點與差額原因、存入銀行。只放在畫面上,重新整理就從頭開始;[送出] 時組成結帳內容(類型 = 日結)。
 * 第 ① 步:涵蓋計算的交班結帳**全部核准**才能到下一步(狀態由 `board:<分店>` 即時更新)。
 */
export const useDailyCloseWizard = ({
  wizard,
  initialDraft,
}: DailyCloseWizardInput) => {
  const initialStocktake = initialDraft?.stocktake ?? null;
  const [step, setStep] = useState<DailyCloseStep>("shifts");
  const [stocktakeMode, setStocktakeMode] = useState<CheckoutStocktakeMode>(
    () => {
      if (initialStocktake !== null) {
        return initialStocktake.mode;
      }
      return wizard.reusableStocktake == null ? "new" : "reuse";
    },
  );
  const [skipReason, setSkipReason] = useState<ReasonValue>(() =>
    initialStocktake?.mode === "skip"
      ? {
          reasonKey: initialStocktake.reasonKey,
          reasonNote: initialStocktake.reasonNote ?? "",
        }
      : EMPTY_REASON,
  );
  const [counts, setCounts] = useState<Record<number, number>>(() =>
    Object.fromEntries(
      (initialDraft?.denominations ?? []).map((row) => [row.value, row.count]),
    ),
  );
  const [diffReason, setDiffReason] = useState<ReasonValue>(() =>
    initialDraft?.diffReasonKey == null
      ? EMPTY_REASON
      : {
          reasonKey: initialDraft.diffReasonKey,
          reasonNote: initialDraft.diffReasonNote ?? "",
        },
  );
  const [depositAmount, setDepositAmount] = useState(
    initialDraft === null ? "" : String(initialDraft.bankDeposit.amount),
  );
  const [chosenAccount, setChosenAccount] = useState(
    initialDraft?.bankDeposit.accountId ?? "",
  );
  const stocktake = useStocktakeFlow({
    orgId: wizard.org.id,
    scopeCashPointId: null,
    initialDraft:
      initialStocktake?.mode === "new" ? initialStocktake.draft : null,
  });

  const denominations = CHECKOUT_DENOMINATIONS.map((value) => ({
    value,
    count: counts[value] ?? 0,
  }));
  const counted = countedTotalOf(denominations);
  const difference = counted - wizard.vaultExpected;
  // 只有一個帳戶時自動帶入
  const accountId =
    chosenAccount === "" && wizard.bankAccounts.length === 1
      ? (wizard.bankAccounts[0]?.id ?? "")
      : chosenAccount;
  const deposit = depositAmount.trim() === "" ? 0 : Number(depositAmount);
  const depositProblem = bankDepositProblemOf({
    amount: deposit,
    accountId: accountId === "" ? null : accountId,
    available: counted,
  });

  const allApproved = wizard.shifts.every((row) => row.state === "approved");
  const unapproved = wizard.shifts.filter(
    (row) => row.state !== "approved",
  ).length;
  const blocked = wizard.openShifts.length > 0 || wizard.pending != null;

  const review = stocktake.review;
  const stocktakeReviewed =
    stocktake.step === "review" &&
    review !== null &&
    !stocktake.reviewQuery.isFetching &&
    review.staleCount === 0 &&
    stocktake.state !== null &&
    unhandledOf(review, stocktake.state) === 0 &&
    lostChoicesReady(stocktake.state);
  const stocktakeReady = (() => {
    switch (stocktakeMode) {
      case "reuse": {
        return wizard.reusableStocktake != null;
      }
      case "skip": {
        return (
          wizard.canSkipStocktake &&
          missingReasonFields(skipReason).length === 0
        );
      }
      case "new": {
        return stocktakeReviewed;
      }
    }
  })();
  const vaultReady =
    !isDiffReasonRequired(difference) ||
    missingReasonFields(diffReason).length === 0;

  const canContinue = (() => {
    switch (step) {
      case "shifts": {
        return allApproved && !blocked;
      }
      case "stocktake": {
        return stocktakeReady;
      }
      case "vault": {
        return vaultReady;
      }
      case "bank": {
        return depositProblem === null;
      }
      case "confirm": {
        return wizard.canSubmit && !blocked && allApproved;
      }
    }
  })();
  const stepIndex = DAILY_CLOSE_STEPS.indexOf(step);
  const next = () => {
    const following = DAILY_CLOSE_STEPS.at(stepIndex + 1);
    if (following !== undefined && canContinue) {
      setStep(following);
    }
  };
  const back = () => {
    const previous =
      stepIndex > 0 ? DAILY_CLOSE_STEPS.at(stepIndex - 1) : undefined;
    if (previous !== undefined) {
      setStep(previous);
    }
  };

  const draftOf = (): DailyCloseDraft | null => {
    let choice: DailyCloseDraft["stocktake"];
    if (stocktakeMode === "skip") {
      choice = { mode: "skip", ...reasonInputOf(skipReason) };
    } else if (stocktakeMode === "reuse") {
      if (wizard.reusableStocktake == null) {
        return null;
      }
      choice = {
        mode: "reuse",
        submissionId: wizard.reusableStocktake.submissionId,
      };
    } else {
      if (stocktake.draft === null) {
        return null;
      }
      choice = { mode: "new", draft: stocktake.draft };
    }
    const reason = isDiffReasonRequired(difference)
      ? reasonInputOf(diffReason)
      : { reasonKey: null, reasonNote: null };
    return {
      version: 1,
      type: CHECKOUT_TYPE.daily,
      orgId: wizard.org.id,
      stocktake: choice,
      denominations: denominations.filter((row) => row.count > 0),
      diffReasonKey: reason.reasonKey,
      diffReasonNote: reason.reasonNote,
      bankDeposit: {
        amount: deposit,
        accountId: deposit > 0 && accountId !== "" ? accountId : null,
      },
    };
  };

  /** 結帳確認申請的值(分店、類型 = 日結、小金庫應有 / 實點 / 差額、結帳內容)。 */
  const valuesOf = (): StoredValues | null => {
    const draft = draftOf();
    if (draft === null) {
      return null;
    }
    return {
      [CHECKOUT_FIELD_KEYS.branch]: wizard.org.id,
      [CHECKOUT_FIELD_KEYS.type]: CHECKOUT_TYPE.daily,
      [CHECKOUT_FIELD_KEYS.cashPoint]: null,
      [CHECKOUT_FIELD_KEYS.successor]: null,
      [CHECKOUT_FIELD_KEYS.expected]: wizard.vaultExpected,
      [CHECKOUT_FIELD_KEYS.counted]: counted,
      [CHECKOUT_FIELD_KEYS.difference]: difference,
      [CHECKOUT_FIELD_KEYS.leftForNext]: 0,
      [CHECKOUT_FIELD_KEYS.note]: null,
      [CHECKOUT_FIELD_KEYS.draft]: serializeDailyCloseDraft(draft),
    };
  };

  return {
    step,
    stepIndex,
    next,
    back,
    canContinue,
    allApproved,
    unapproved,
    stocktakeMode,
    setStocktakeMode,
    skipReason,
    setSkipReason,
    stocktake,
    stocktakeReviewed,
    denominations,
    setCount: (value: number, count: number) => {
      setCounts((before) => ({ ...before, [value]: count }));
    },
    counted,
    difference,
    diffReason,
    setDiffReason,
    depositAmount,
    setDepositAmount,
    deposit,
    accountId,
    setAccountId: setChosenAccount,
    depositProblem,
    valuesOf,
  };
};

export type DailyCloseWizard = ReturnType<typeof useDailyCloseWizard>;
