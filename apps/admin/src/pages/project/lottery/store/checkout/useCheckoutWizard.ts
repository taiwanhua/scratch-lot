import { useState } from "react";

import type { StoredValues } from "@repo/domain/form";
import {
  CHECKOUT_DENOMINATIONS,
  CHECKOUT_FIELD_KEYS,
  CHECKOUT_TYPE,
  type CheckoutDraft,
  type CheckoutStocktakeMode,
  checkoutHandoverProblemOf,
  countedTotalOf,
  isDiffReasonRequired,
  serializeCheckoutDraft,
} from "@repo/domain/project/lottery";
import type { LotteryCheckoutWizardQuery as WizardQuery } from "@repo/graphql";

import {
  EMPTY_REASON,
  type ReasonValue,
  missingReasonFields,
  reasonInputOf,
} from "@/components/project/lottery/ReasonFields/reason-value";

import { lostChoicesReady, unhandledOf } from "../stocktake/stocktake-model";
import { useStocktakeFlow } from "../stocktake/useStocktakeFlow";
import { CHECKOUT_STEPS, type CheckoutStep } from "./checkout-keys";

export type CheckoutWizardData = WizardQuery["lotteryCheckoutWizard"];

/** 差額原因「審核中的單據」的選項代碼(欄位管理「結帳差額原因」的種子;自動帶入用)。 */
export const PENDING_DOCUMENTS_REASON_KEY = "pending-documents";

export interface CheckoutWizardInput {
  wizard: CheckoutWizardData;
  /** 退回後再送出:帶入原內容 */
  initialDraft: CheckoutDraft | null;
}

/**
 * 交班精靈的畫面狀態與規則(規格 6.0、6.9):步驟、盤點方式(現在盤點的狀態在 `useStocktakeFlow`)、
 * 依面額清點、差額原因、交接。只放在畫面上,重新整理就從頭開始;[送出] 時組成結帳內容。
 */
export const useCheckoutWizard = ({
  wizard,
  initialDraft,
}: CheckoutWizardInput) => {
  const initialStocktake = initialDraft?.stocktake ?? null;
  const [step, setStep] = useState<CheckoutStep>("stocktake");
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
  const [leftForNext, setLeftForNext] = useState(
    initialDraft === null ? "" : String(initialDraft.leftForNext),
  );
  const [successorId, setSuccessorId] = useState(
    initialDraft?.successorId ?? "",
  );
  const stocktake = useStocktakeFlow({
    orgId: wizard.shift.orgId,
    scopeCashPointId: wizard.shift.cashPoint.id,
    initialDraft:
      initialStocktake?.mode === "new" ? initialStocktake.draft : null,
  });

  const denominations = CHECKOUT_DENOMINATIONS.map((value) => ({
    value,
    count: counts[value] ?? 0,
  }));
  const counted = countedTotalOf(denominations);
  const difference = counted - wizard.expected;
  const left = leftForNext.trim() === "" ? 0 : Number(leftForNext);
  const handoverProblem = checkoutHandoverProblemOf({
    leftForNext: left,
    successorId: successorId === "" ? null : successorId,
    counted,
  });

  /** 現在盤點:差異核對乾淨(沒有已被處理、沒有未處理、待查清單都填好)。 */
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
  const drawerReady =
    !isDiffReasonRequired(difference) ||
    missingReasonFields(diffReason).length === 0;
  const confirmReady = handoverProblem === null;

  const canContinue = (() => {
    switch (step) {
      case "stocktake": {
        return stocktakeReady;
      }
      case "redemption": {
        return true;
      }
      case "drawer": {
        return drawerReady;
      }
      case "confirm": {
        return confirmReady && wizard.canSubmit;
      }
    }
  })();
  const stepIndex = CHECKOUT_STEPS.indexOf(step);
  const next = () => {
    const following = CHECKOUT_STEPS.at(stepIndex + 1);
    if (following !== undefined && canContinue) {
      setStep(following);
    }
  };
  const back = () => {
    const previous =
      stepIndex > 0 ? CHECKOUT_STEPS.at(stepIndex - 1) : undefined;
    if (previous !== undefined) {
      setStep(previous);
    }
  };

  /** 審核中的單據 → 差額原因自動帶入「審核中的單據」+ 說明帶那幾張單的摘要(規格 6.9;使用者可以改)。 */
  const autoFillPending = (note: string) => {
    if (wizard.pendingImpacts.length > 0 && diffReason.reasonKey === "") {
      setDiffReason({
        reasonKey: PENDING_DOCUMENTS_REASON_KEY,
        reasonNote: note,
      });
    }
  };

  const draftOf = (): CheckoutDraft | null => {
    let choice: CheckoutDraft["stocktake"];
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
      type: CHECKOUT_TYPE.shift,
      orgId: wizard.shift.orgId,
      shiftId: wizard.shift.id,
      cashPointId: wizard.shift.cashPoint.id,
      stocktake: choice,
      denominations: denominations.filter((row) => row.count > 0),
      diffReasonKey: reason.reasonKey,
      diffReasonNote: reason.reasonNote,
      leftForNext: left,
      successorId: successorId === "" ? null : successorId,
    };
  };

  /** 結帳確認申請的值(分店、類型、收銀點、接班人、應有 / 實點 / 差額 / 留給下一班、結帳內容)。 */
  const valuesOf = (): StoredValues | null => {
    const draft = draftOf();
    if (draft === null) {
      return null;
    }
    const successor = wizard.successorOptions.find(
      (option) => option.id === successorId,
    );
    return {
      [CHECKOUT_FIELD_KEYS.branch]: wizard.shift.orgId,
      [CHECKOUT_FIELD_KEYS.type]: CHECKOUT_TYPE.shift,
      [CHECKOUT_FIELD_KEYS.cashPoint]: wizard.shift.cashPoint.name,
      [CHECKOUT_FIELD_KEYS.successor]:
        successor === undefined
          ? null
          : { id: successor.id, label: successor.name },
      [CHECKOUT_FIELD_KEYS.expected]: wizard.expected,
      [CHECKOUT_FIELD_KEYS.counted]: counted,
      [CHECKOUT_FIELD_KEYS.difference]: difference,
      [CHECKOUT_FIELD_KEYS.leftForNext]: left,
      [CHECKOUT_FIELD_KEYS.note]: null,
      [CHECKOUT_FIELD_KEYS.draft]: serializeCheckoutDraft(draft),
    };
  };

  return {
    step,
    stepIndex,
    next,
    back,
    canContinue,
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
    autoFillPending,
    leftForNext,
    setLeftForNext,
    left,
    successorId,
    setSuccessorId,
    handoverProblem,
    valuesOf,
  };
};

export type CheckoutWizard = ReturnType<typeof useCheckoutWizard>;
