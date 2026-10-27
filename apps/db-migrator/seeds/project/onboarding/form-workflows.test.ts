import { describe, expect, it } from "@jest/globals";

import { applicantAsReviewerOf } from "@repo/domain/workflow";

import type { OnboardingContext } from "./context";
import { FORM_WORKFLOWS } from "./form-workflows";

const context = {
  plan: { headquartersBranch: null },
  state: {
    roleIds: new Map([
      ["hq", "role-hq"],
      ["store-manager", "role-manager"],
    ]),
    branchIds: new Map(),
  },
} as unknown as OnboardingContext;

/**
 * 開通時建立的每一關「申請人也是審核者時」(規格 2.1):申請人可能同時是審核者的關卡不能留底座預設的「剔除」,
 * 否則每家分店只有一位店長時,店長自己送的單會找不到審核者而卡住。
 */
const EXPECTED: Record<string, Record<string, string>> = {
  support_request: { hq: "review" },
  requisition: { hq: "review" },
  purchase: { receive: "review" },
  transfer: { ship: "review", receive: "review" },
  makeup_punch: { store_manager: "review" },
  sale_reversal: { store_manager: "auto" },
  cash_correction: { store_manager: "auto" },
  stocktake_confirm: { store_manager: "auto" },
  // 接班人不能是申請人自己(結帳精靈擋),第 1 關維持預設
  checkout_confirm: { successor: "exclude", store_manager: "review" },
};

describe("開通流程:申請人也是審核者時", () => {
  it("每張表單每一關的設定(剔除 / 自動通過 / 照常審核)", () => {
    const actual = Object.fromEntries(
      FORM_WORKFLOWS.map((spec) => [
        spec.formKey,
        Object.fromEntries(
          spec
            .steps(context)
            .map((step) => [
              step.key as string,
              applicantAsReviewerOf(
                step.autoApprove as Parameters<typeof applicantAsReviewerOf>[0],
              ),
            ]),
        ),
      ]),
    );
    expect(actual).toEqual(EXPECTED);
  });
});
