import { describe, expect, it } from "@jest/globals";

import { SHARED_FIELD_CATEGORY_KEYS } from "@repo/domain/project/reason-note";

import { assembleSeedRegistry } from "../registry";
import { FORM_WORKFLOWS } from "./onboarding/form-workflows";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import {
  PURCHASING_GROUP_KEY,
  purchasingModuleDeclarations,
  purchasingRequisitionModule,
} from "./purchasing";
import { projectSeedSource } from "./registry";
import { seed as requisitionForm } from "./revisions/requisition.r3.seed";
import { projectSeedSettings } from "./settings";

describe("叫貨與進貨的模組宣告(規格 3.1、3.2)", () => {
  it("群組(order 30)+ 叫貨、採購單(表單模組)與三個隱藏頁", () => {
    expect(
      purchasingModuleDeclarations
        .flatMap((declaration) => declaration.nodes)
        .map((node) => [node.key, node.sidebarType, node.engine ?? "fixed"]),
    ).toEqual([
      [PURCHASING_GROUP_KEY, "group", "fixed"],
      ["purchasing.requisition", "link", "form"],
      ["purchasing.requisition.view-page", "hidden", "fixed"],
      ["purchasing.requisition.create-page", "hidden", "fixed"],
      ["purchasing.requisition.edit-page", "hidden", "fixed"],
    ]);
    expect(
      purchasingModuleDeclarations[0]?.nodes.map((node) => node.order),
    ).toEqual([30]);
  });

  it("權限照規格 3.2:表單四條 + 採購清單 `purchase-list`", () => {
    expect(
      (purchasingRequisitionModule.permissions ?? []).map(
        (permission) => permission.key,
      ),
    ).toEqual([
      "purchasing.requisition.view",
      "purchasing.requisition.create",
      "purchasing.requisition.edit",
      "purchasing.requisition.delete",
      "purchasing.requisition.purchase-list",
    ]);
  });

  it("登記進專案來源(含受管表單 叫貨單),與底座一起組裝不衝突", () => {
    expect(projectSeedSource.moduleDeclarations).toEqual(
      expect.arrayContaining([...purchasingModuleDeclarations]),
    );
    expect(projectSeedSource.seeds).toContain(requisitionForm);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });

  it("受管表單 叫貨單:允許存草稿、單號 R-0001、綁 purchasing.requisition、作廢原因用「作廢原因」類別", () => {
    expect(requisitionForm).toMatchObject({
      key: "requisition",
      moduleKey: "purchasing.requisition",
      allowDraft: true,
      serial: { prefix: "R", period: "none", digits: 4 },
      voidReasonCategoryKey: SHARED_FIELD_CATEGORY_KEYS.voidReason,
    });
  });

  it("列表欄位配置初值:單號、叫貨分店、期望到貨日、本數 + 狀態、建立者", () => {
    const settings =
      projectSeedSettings.moduleInitialValues["purchasing.requisition"]
        ?.settings;
    expect(settings).toMatchObject({
      list: {
        columns: [
          { kind: "slot", key: "serialNo" },
          { kind: "field", key: "branch", formKey: "requisition" },
          { kind: "field", key: "expected_date", formKey: "requisition" },
          { kind: "field", key: "total_books", formKey: "requisition" },
        ],
        builtin: { form: false, status: true, createdBy: true },
      },
    });
  });
});

describe("開通時建立的角色與流程(規格 2.1、3.3)", () => {
  it("總部管理有叫貨、採購單全部;店長有表單四條、沒有採購清單;店員沒有", () => {
    const hq = roleGrantOf("hq", ROLE_GRANT_SECTIONS);
    expect(hq.permissionKeys).toContain("purchasing.requisition.*");
    const manager = roleGrantOf("store-manager", ROLE_GRANT_SECTIONS);
    expect(manager.moduleKeys).toContain("purchasing.requisition");
    expect(manager.permissionKeys).toEqual(
      expect.arrayContaining([
        "purchasing.requisition.view",
        "purchasing.requisition.create",
      ]),
    );
    expect(manager.permissionKeys).not.toContain(
      "purchasing.requisition.purchase-list",
    );
    expect(manager.permissionKeys).not.toContain("purchasing.requisition.*");
    const clerk = roleGrantOf("clerk", ROLE_GRANT_SECTIONS);
    expect(
      clerk.moduleKeys.filter((key) => key.startsWith("purchasing")),
    ).toEqual([]);
  });

  it("叫貨單的流程登記在開通腳本的「流程」步驟", () => {
    expect(FORM_WORKFLOWS.map((spec) => spec.formKey)).toContain("requisition");
  });
});
