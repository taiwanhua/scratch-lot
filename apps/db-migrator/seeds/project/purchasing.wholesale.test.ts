import { describe, expect, it } from "@jest/globals";

import { assembleSeedRegistry } from "../registry";
import { type OnboardingContext, emptyState } from "./onboarding/context";
import { FORM_WORKFLOWS } from "./onboarding/form-workflows";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { purchasingWholesaleModule } from "./purchasing.wholesale";
import { projectSeedSource } from "./registry";
import { seed as wholesaleForm } from "./revisions/wholesale.r1.seed";
import { projectSeedSettings } from "./settings";

describe("批售單的模組宣告(規格 21.8)", () => {
  it("表單模組掛在叫貨與進貨底下、排在調貨單之後 + 三個隱藏頁", () => {
    expect(
      purchasingWholesaleModule.nodes.map((node) => [
        node.key,
        node.sidebarType,
        node.parentKey,
      ]),
    ).toEqual([
      ["purchasing.wholesale", "link", "purchasing"],
      ["purchasing.wholesale.view-page", "hidden", "purchasing.wholesale"],
      ["purchasing.wholesale.create-page", "hidden", "purchasing.wholesale"],
      ["purchasing.wholesale.edit-page", "hidden", "purchasing.wholesale"],
    ]);
    expect(purchasingWholesaleModule.nodes[0]?.order).toBe(4);
  });

  it("權限:表單四條 + `receive`", () => {
    expect(
      (purchasingWholesaleModule.permissions ?? []).map(
        (permission) => permission.key,
      ),
    ).toEqual([
      "purchasing.wholesale.view",
      "purchasing.wholesale.create",
      "purchasing.wholesale.edit",
      "purchasing.wholesale.delete",
      "purchasing.wholesale.receive",
    ]);
  });

  it("登記進專案來源(含受管表單 批售單),與底座一起組裝不衝突(定義檢查與可攜性檢查都過)", () => {
    expect(projectSeedSource.moduleDeclarations).toContain(
      purchasingWholesaleModule,
    );
    expect(projectSeedSource.seeds).toContain(wholesaleForm);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });

  it("受管表單 批售單:允許存草稿、單號 W-0001、作廢原因、依出貨分店共用;單頭與明細欄位", () => {
    expect(wholesaleForm).toMatchObject({
      key: "wholesale",
      revision: "r1",
      moduleKey: "purchasing.wholesale",
      allowDraft: true,
      voidReasonCategoryKey: "void-reason",
      sharedByFieldKeys: ["from_branch"],
      serial: { prefix: "W", period: "none", digits: 4 },
    });
    expect(wholesaleForm.definition.fields.map((field) => field.key)).toEqual([
      "from_branch",
      "customer",
      "payment_mode",
      "account",
      "lines",
      "wholesale_total",
      "note",
    ]);
    const byKey = new Map(
      wholesaleForm.definition.fields.map((field) => [field.key, field]),
    );
    expect(byKey.get("customer")).toMatchObject({
      source: {
        provider: "lottery_wholesale_customer",
        labelField: "label",
        filter: { status: "active" },
      },
    });
    expect(byKey.get("payment_mode")).toMatchObject({
      default: { kind: "constant", value: "collect_first" },
      rules: { required: true },
    });
    expect(byKey.get("account")).toMatchObject({
      visibleWhen: { "==": [{ var: "payment_mode" }, "auto_bank"] },
      rules: { required: true },
    });
    const lines = byKey.get("lines");
    expect(
      lines !== undefined && "columns" in lines
        ? (lines.columns ?? []).map((column) => column.key)
        : [],
    ).toEqual(["game", "book", "tickets", "book_price", "rate", "amount"]);
    expect(lines).toMatchObject({ rules: { required: true, maxRows: 200 } });
  });
});

describe("開通時建立的角色與流程(規格 21.2、21.4、21.8)", () => {
  it("總部管理、店長有批售單全部;店員沒有批售單與批售客戶", () => {
    for (const role of ["hq", "store-manager"] as const) {
      expect(roleGrantOf(role, ROLE_GRANT_SECTIONS).permissionKeys).toContain(
        "purchasing.wholesale.*",
      );
    }
    expect(
      roleGrantOf("clerk", ROLE_GRANT_SECTIONS).moduleKeys.filter(
        (key) =>
          key.startsWith("purchasing.wholesale") ||
          key.startsWith("dealers.wholesale-customers"),
      ),
    ).toEqual([]);
  });

  it("批售客戶:總部管理全部;店長只看(分頁與詳情,沒有新增 / 編輯)", () => {
    const manager = roleGrantOf("store-manager", ROLE_GRANT_SECTIONS);
    expect(
      manager.moduleKeys.filter((key) =>
        key.startsWith("dealers.wholesale-customers"),
      ),
    ).toEqual([
      "dealers.wholesale-customers",
      "dealers.wholesale-customers.view-page",
    ]);
    expect(
      manager.permissionKeys.filter((key) =>
        key.startsWith("dealers.wholesale-customers"),
      ),
    ).toEqual([]);
    expect(roleGrantOf("hq", ROLE_GRANT_SECTIONS).permissionKeys).toContain(
      "dealers.wholesale-customers.*",
    );
  });

  it("批售單的流程:一關「出貨確認」,店長限定「出貨分店」、不跳過、可退回、申請人也是審核者時照常審核", () => {
    const spec = FORM_WORKFLOWS.find((item) => item.formKey === "wholesale");
    const state = emptyState();
    state.roleIds.set("store-manager", "role-store-manager");
    const steps = spec?.steps({ state } as unknown as OnboardingContext);
    expect(steps).toEqual([
      {
        key: "ship",
        name: "出貨確認",
        kind: "review",
        mode: "any",
        skipWhen: null,
        allowReturn: true,
        autoApprove: { applicant: "review" },
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
                  value: { kind: "dynamic", ref: "form-field:from_branch" },
                  range: "self",
                },
              ],
            },
          },
        },
      },
    ]);
  });
});
