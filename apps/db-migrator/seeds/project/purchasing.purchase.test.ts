import { describe, expect, it } from "@jest/globals";

import { assembleSeedRegistry } from "../registry";
import { type OnboardingContext, emptyState } from "./onboarding/context";
import { FORM_WORKFLOWS } from "./onboarding/form-workflows";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { purchasingPurchaseModule } from "./purchasing.purchase";
import { projectSeedSource } from "./registry";
import { seed as purchaseForm } from "./revisions/purchase.r3.seed";
import { projectSeedSettings } from "./settings";

describe("進貨單的模組宣告(規格 3.1、3.2、8.2)", () => {
  it("表單模組掛在叫貨與進貨底下(order 2)+ 三個隱藏頁", () => {
    expect(
      purchasingPurchaseModule.nodes.map((node) => [
        node.key,
        node.sidebarType,
        node.engine ?? "fixed",
        node.parentKey,
      ]),
    ).toEqual([
      ["purchasing.purchase", "link", "form", "purchasing"],
      [
        "purchasing.purchase.view-page",
        "hidden",
        "fixed",
        "purchasing.purchase",
      ],
      [
        "purchasing.purchase.create-page",
        "hidden",
        "fixed",
        "purchasing.purchase",
      ],
      [
        "purchasing.purchase.edit-page",
        "hidden",
        "fixed",
        "purchasing.purchase",
      ],
    ]);
    expect(purchasingPurchaseModule.nodes[0]?.order).toBe(2);
  });

  it("權限照規格 3.2:表單四條 + `settle`", () => {
    expect(
      (purchasingPurchaseModule.permissions ?? []).map(
        (permission) => permission.key,
      ),
    ).toEqual([
      "purchasing.purchase.view",
      "purchasing.purchase.create",
      "purchasing.purchase.edit",
      "purchasing.purchase.delete",
      "purchasing.purchase.settle",
    ]);
  });

  it("登記進專案來源(含受管表單 進貨單),與底座一起組裝不衝突(定義檢查與可攜性檢查都過)", () => {
    expect(projectSeedSource.moduleDeclarations).toContain(
      purchasingPurchaseModule,
    );
    expect(projectSeedSource.seeds).toContain(purchaseForm);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });

  it("受管表單 進貨單:允許存草稿、單號 P-0001、作廢原因 = 欄位管理「作廢原因」", () => {
    expect(purchaseForm).toMatchObject({
      key: "purchase",
      moduleKey: "purchasing.purchase",
      allowDraft: true,
      voidReasonCategoryKey: "void-reason",
      serial: { prefix: "P", period: "none", digits: 4 },
    });
  });

  it("r3 加兌獎:勾選欄(引用店內持有的兌獎紀錄,帶入中獎金額)與合計三列;扣款金額 = 批購合計 − 兌獎折抵", () => {
    const fields = purchaseForm.definition.fields;
    expect(purchaseForm.revision).toBe("r3");
    expect(fields.map((field) => field.key)).toEqual(
      expect.arrayContaining([
        "redemptions",
        "redemption_total",
        "redemption_offset",
        "redemption_remainder",
      ]),
    );
    const redemptions = fields.find((field) => field.key === "redemptions");
    expect(redemptions).toMatchObject({
      type: "array",
      columns: [
        {
          key: "redemption",
          source: {
            provider: "lottery_redemption",
            filter: { status: "in_store" },
          },
          prefill: {
            mapping: [{ sourceField: "prizeAmount", fieldKey: "prize_amount" }],
          },
        },
        { key: "prize_amount" },
      ],
    });
    expect(
      fields.find((field) => field.key === "deducted_amount")?.valueSource,
    ).toEqual({
      kind: "computed",
      expr: { "-": [{ var: "purchase_total" }, { var: "redemption_offset" }] },
    });
  });

  it("列表欄位配置初值:單號、進貨分店、甲類、批購日、扣款金額 + 狀態", () => {
    expect(
      projectSeedSettings.moduleInitialValues["purchasing.purchase"]?.settings,
    ).toMatchObject({
      list: {
        columns: [
          { kind: "slot", key: "serialNo" },
          { kind: "field", key: "branch", formKey: "purchase" },
          { kind: "field", key: "dealer", formKey: "purchase" },
          { kind: "field", key: "purchase_date", formKey: "purchase" },
          { kind: "field", key: "deducted_amount", formKey: "purchase" },
        ],
        builtin: { form: false, status: true, createdBy: false },
      },
    });
  });
});

describe("開通時建立的角色與流程(規格 2.1、3.3、8.2)", () => {
  it("總部管理有進貨單全部(含 settle);店長只有看(點收是流程關卡);店員沒有", () => {
    expect(roleGrantOf("hq", ROLE_GRANT_SECTIONS).permissionKeys).toContain(
      "purchasing.purchase.*",
    );
    const manager = roleGrantOf("store-manager", ROLE_GRANT_SECTIONS);
    expect(manager.permissionKeys).toContain("purchasing.purchase.view");
    expect(manager.permissionKeys).not.toContain("purchasing.purchase.settle");
    expect(manager.permissionKeys).not.toContain("purchasing.purchase.*");
    expect(
      roleGrantOf("clerk", ROLE_GRANT_SECTIONS).moduleKeys.filter((key) =>
        key.startsWith("purchasing.purchase"),
      ),
    ).toEqual([]);
  });

  it("進貨單的流程:一關「點收」,角色 店長 且 所屬組織屬於「進貨分店」", () => {
    const spec = FORM_WORKFLOWS.find((item) => item.formKey === "purchase");
    const state = emptyState();
    state.roleIds.set("store-manager", "role-store-manager");
    const steps = spec?.steps({ state } as unknown as OnboardingContext);
    expect(steps).toEqual([
      expect.objectContaining({
        key: "receive",
        name: "點收",
        assignee: {
          kind: "audience",
          audience: {
            mode: "match",
            filter: {
              op: "AND",
              children: [
                {
                  field: "role",
                  cond: "in",
                  value: { kind: "static", values: ["role-store-manager"] },
                },
                {
                  field: "org",
                  cond: "in",
                  value: { kind: "dynamic", ref: "form-field:branch" },
                  range: "self",
                },
              ],
            },
          },
        },
      }),
    ]);
  });
});
