import { describe, expect, it } from "@jest/globals";

import {
  CASH_CORRECTION_FIELD_KEYS,
  CASH_CORRECTION_FORM_KEY,
  SALE_REVERSAL_FIELD_KEYS,
  SALE_REVERSAL_FORM_KEY,
  STORE_KEY,
} from "@repo/domain/project/lottery";
import { SHARED_FIELD_CATEGORY_KEYS } from "@repo/domain/project/reason-note";

import { assembleSeedRegistry } from "../registry";
import type { OnboardingContext } from "./onboarding/context";
import {
  cashCorrectionWorkflow,
  saleReversalWorkflow,
} from "./onboarding/form-workflows/store-forms";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { projectSeedSource } from "./registry";
import { seed as cashCorrectionForm } from "./revisions/cash_correction.r1.seed";
import { seed as saleReversalForm } from "./revisions/sale_reversal.r1.seed";
import { projectSeedSettings } from "./settings";

const keysOf = (form: { definition: { fields: readonly { key: string }[] } }) =>
  form.definition.fields.map((field) => field.key).toSorted();

/** 店面管理的兩張受管表單(規格 8.5、8.8;正本 `docs/modules/project/store.md`「撤銷售出申請與現金更正單」)。 */
describe("受管表單 撤銷售出申請(sale_reversal r1)、現金更正單(cash_correction r1)", () => {
  it("登記進專案來源,與底座一起組裝不衝突(定義檢查與可攜性檢查都過)", () => {
    expect(projectSeedSource.seeds).toContain(saleReversalForm);
    expect(projectSeedSource.seeds).toContain(cashCorrectionForm);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });

  it("綁店面管理、沒有草稿、單號 R / X、作廢原因 = 共用的「作廢原因」", () => {
    for (const [form, key, prefix] of [
      [saleReversalForm, SALE_REVERSAL_FORM_KEY, "R"],
      [cashCorrectionForm, CASH_CORRECTION_FORM_KEY, "X"],
    ] as const) {
      expect(form).toMatchObject({
        key,
        moduleKey: STORE_KEY,
        allowDraft: false,
        voidReasonCategoryKey: SHARED_FIELD_CATEGORY_KEYS.voidReason,
        serial: { prefix, period: "none", digits: 4 },
      });
    }
  });

  it("欄位 key 與 domain 的欄位常數一致(掛接點與新增頁讀同一份)", () => {
    expect(keysOf(saleReversalForm)).toEqual(
      Object.values(SALE_REVERSAL_FIELD_KEYS)
        .filter(
          (key) => !["book", "ticket_nos", "tickets", "amount"].includes(key),
        )
        .toSorted(),
    );
    expect(keysOf(cashCorrectionForm)).toEqual(
      Object.values(CASH_CORRECTION_FIELD_KEYS).toSorted(),
    );
  });
});

describe("開通時建立的流程與角色(規格 2.1、3.3)", () => {
  it("兩張表單都是一關「店長限定分店」+ 申請人是審核者時自動通過(B5)", () => {
    const context = {
      state: { roleIds: new Map([["store-manager", "role-manager"]]) },
    } as unknown as OnboardingContext;
    for (const workflow of [saleReversalWorkflow, cashCorrectionWorkflow]) {
      const steps = workflow.steps(context);
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({
        kind: "review",
        autoApprove: { applicant: true },
        assignee: {
          kind: "audience",
          audience: {
            filter: {
              children: [
                { field: "role", value: { values: ["role-manager"] } },
                {
                  field: "org",
                  value: { kind: "dynamic", ref: "form-field:branch" },
                  range: "self",
                },
              ],
            },
          },
        },
      });
    }
    expect(saleReversalWorkflow.formKey).toBe(SALE_REVERSAL_FORM_KEY);
    expect(cashCorrectionWorkflow.formKey).toBe(CASH_CORRECTION_FORM_KEY);
  });

  it("店員有撤銷售出與現金更正的新增(B9b `store.create-<formKey>`)", () => {
    expect(roleGrantOf("clerk", ROLE_GRANT_SECTIONS).permissionKeys).toEqual(
      expect.arrayContaining([
        "store.create-sale_reversal",
        "store.create-cash_correction",
      ]),
    );
  });
});
