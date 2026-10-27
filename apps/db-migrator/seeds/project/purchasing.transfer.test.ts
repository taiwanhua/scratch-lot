import { describe, expect, it } from "@jest/globals";

import { assembleSeedRegistry } from "../registry";
import { type OnboardingContext, emptyState } from "./onboarding/context";
import { FORM_WORKFLOWS } from "./onboarding/form-workflows";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { purchasingTransferModule } from "./purchasing.transfer";
import { projectSeedSource } from "./registry";
import { seed as transferForm } from "./revisions/transfer.r3.seed";
import { projectSeedSettings } from "./settings";

describe("調貨單的模組宣告(規格 3.1、3.2、8.4)", () => {
  it("表單模組掛在叫貨與進貨底下(order 3)+ 三個隱藏頁", () => {
    expect(
      purchasingTransferModule.nodes.map((node) => [
        node.key,
        node.sidebarType,
        node.parentKey,
      ]),
    ).toEqual([
      ["purchasing.transfer", "link", "purchasing"],
      ["purchasing.transfer.view-page", "hidden", "purchasing.transfer"],
      ["purchasing.transfer.create-page", "hidden", "purchasing.transfer"],
      ["purchasing.transfer.edit-page", "hidden", "purchasing.transfer"],
    ]);
    expect(purchasingTransferModule.nodes[0]?.order).toBe(3);
  });

  it("權限照規格 3.2:表單四條 + `partial-tickets`、`pay`、`receive`", () => {
    expect(
      (purchasingTransferModule.permissions ?? []).map(
        (permission) => permission.key,
      ),
    ).toEqual([
      "purchasing.transfer.view",
      "purchasing.transfer.create",
      "purchasing.transfer.edit",
      "purchasing.transfer.delete",
      "purchasing.transfer.partial-tickets",
      "purchasing.transfer.pay",
      "purchasing.transfer.receive",
    ]);
  });

  it("登記進專案來源(含受管表單 調貨單),與底座一起組裝不衝突(定義檢查與可攜性檢查都過)", () => {
    expect(projectSeedSource.moduleDeclarations).toContain(
      purchasingTransferModule,
    );
    expect(projectSeedSource.seeds).toContain(transferForm);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });

  it("受管表單 調貨單:允許存草稿、單號 T-0001、作廢原因 = 欄位管理「作廢原因」;明細的本只列正常的", () => {
    expect(transferForm).toMatchObject({
      key: "transfer",
      moduleKey: "purchasing.transfer",
      allowDraft: true,
      voidReasonCategoryKey: "void-reason",
      // 依欄位共用:分店欄指到的分店也看得到(唯讀)
      sharedByFieldKeys: ["from_branch", "to_branch"],
      serial: { prefix: "T", period: "none", digits: 4 },
    });
    const lines = transferForm.definition.fields.find(
      (field) => field.key === "lines",
    );
    expect(
      lines !== undefined && "columns" in lines
        ? (lines.columns ?? []).map((column) => column.key)
        : [],
    ).toEqual([
      "game",
      "book",
      "mode",
      "ticket_nos",
      "tickets",
      "amount",
      "rate",
      "purchase_amount",
    ]);
  });

  it("列表欄位配置初值:單號、出貨店、收貨店、調貨金額 + 狀態", () => {
    expect(
      projectSeedSettings.moduleInitialValues["purchasing.transfer"]?.settings,
    ).toMatchObject({
      list: {
        columns: [
          { kind: "slot", key: "serialNo" },
          { kind: "field", key: "from_branch", formKey: "transfer" },
          { kind: "field", key: "to_branch", formKey: "transfer" },
          { kind: "field", key: "transfer_total", formKey: "transfer" },
        ],
        builtin: { form: false, status: true, createdBy: false },
      },
    });
  });
});

/** 「角色 店長 且 所屬組織屬於表單欄位 X(本身)」的人員條件。 */
const orgOf = (field: string) => ({
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
          value: { kind: "dynamic", ref: `form-field:${field}` },
          range: "self",
        },
      ],
    },
  },
});

describe("開通時建立的角色與流程(規格 2.1、3.3、8.4)", () => {
  it("總部管理、店長有調貨單全部;店員沒有", () => {
    for (const role of ["hq", "store-manager"] as const) {
      expect(roleGrantOf(role, ROLE_GRANT_SECTIONS).permissionKeys).toContain(
        "purchasing.transfer.*",
      );
    }
    expect(
      roleGrantOf("clerk", ROLE_GRANT_SECTIONS).moduleKeys.filter((key) =>
        key.startsWith("purchasing.transfer"),
      ),
    ).toEqual([]);
  });

  it("調貨單的流程:第 1 關店長限定「出貨分店」(當前組織 = 出貨分店時跳過);第 2 關店長限定「收貨分店」", () => {
    const spec = FORM_WORKFLOWS.find((item) => item.formKey === "transfer");
    const state = emptyState();
    state.roleIds.set("store-manager", "role-store-manager");
    const steps = spec?.steps({ state } as unknown as OnboardingContext);
    expect(steps).toEqual([
      expect.objectContaining({
        key: "ship",
        name: "出貨確認",
        assignee: orgOf("from_branch"),
        skipWhen: { "==": [{ var: "ctx.user.orgId" }, { var: "from_branch" }] },
      }),
      expect.objectContaining({
        key: "receive",
        name: "點收",
        assignee: orgOf("to_branch"),
        skipWhen: null,
      }),
    ]);
  });
});
