import { describe, expect, it } from "@jest/globals";

import { VOID_REASON_CATEGORY_KEY } from "@repo/domain/form";
import {
  CHECKOUT_CONFIRM_FORM_KEY,
  CHECKOUT_CREATE_PERMISSION,
  CHECKOUT_FIELD_KEYS,
  STORE_KEY,
} from "@repo/domain/project/lottery";

import { assembleSeedRegistry } from "../registry";
import { FORM_WORKFLOWS } from "./onboarding/form-workflows";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { projectSeedSource } from "./registry";
import { seed as checkoutForm } from "./revisions/checkout_confirm.r2.seed";
import { projectSeedSettings } from "./settings";

const fieldOf = (key: string) =>
  checkoutForm.definition.fields.find((field) => field.key === key);

/** 結帳確認申請的受管表單(規格 8.7;正本 `docs/modules/project/store.md`「交班結帳」)。 */
describe("受管表單 結帳確認申請(checkout_confirm r1)", () => {
  it("登記進專案來源,與底座一起組裝不衝突(定義檢查與可攜性檢查都過)", () => {
    expect(projectSeedSource.seeds).toContain(checkoutForm);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });

  it("綁在店面管理、沒有草稿、單號 C-0001、作廢原因 = 共用的「作廢原因」(作廢由掛接點一律擋下)", () => {
    expect(checkoutForm).toMatchObject({
      key: CHECKOUT_CONFIRM_FORM_KEY,
      moduleKey: STORE_KEY,
      allowDraft: false,
      voidReasonCategoryKey: VOID_REASON_CATEGORY_KEY,
      // 依欄位共用:分店欄指到的分店也看得到(唯讀)
      sharedByFieldKeys: ["branch"],
      serial: { prefix: "C", period: "none", digits: 4 },
    });
  });

  it("欄位 key 對得上程式;類型是交班 / 日結;接班人是使用者引用欄(流程第 1 關的審核者);結帳內容唯讀時不顯示", () => {
    for (const key of Object.values(CHECKOUT_FIELD_KEYS)) {
      expect(fieldOf(key)).toBeDefined();
    }
    expect(fieldOf(CHECKOUT_FIELD_KEYS.branch)).toMatchObject({
      type: "reference",
      source: { provider: "org" },
    });
    expect(fieldOf(CHECKOUT_FIELD_KEYS.type)).toMatchObject({
      type: "select",
      options: {
        kind: "static",
        items: [
          expect.objectContaining({ value: "shift" }),
          expect.objectContaining({ value: "daily" }),
        ],
      },
    });
    expect(fieldOf(CHECKOUT_FIELD_KEYS.successor)).toMatchObject({
      type: "reference",
      source: { provider: "user" },
    });
    expect(fieldOf(CHECKOUT_FIELD_KEYS.draft)?.widget).toMatchObject({
      hideWhenReadonly: true,
    });
  });
});

describe("開通(規格 2.1、3.3)", () => {
  it("流程兩關:第 1 關審核者 = 欄位「接班人」(日結或沒有接班人跳過);第 2 關店長限定「分店」(交班且有接班人跳過)", () => {
    const spec = FORM_WORKFLOWS.find(
      (item) => item.formKey === CHECKOUT_CONFIRM_FORM_KEY,
    );
    expect(spec).toBeDefined();
    const steps =
      spec?.steps({
        state: { roleIds: new Map([["store-manager", "role-1"]]) },
      } as never) ?? [];
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      key: "successor",
      assignee: {
        kind: "field",
        formKey: CHECKOUT_CONFIRM_FORM_KEY,
        fieldKey: CHECKOUT_FIELD_KEYS.successor,
      },
      skipWhen: {
        or: [
          { "==": [{ var: "type" }, "daily"] },
          { "!": { var: "successor" } },
        ],
      },
    });
    expect(steps[1]).toMatchObject({
      key: "store_manager",
      skipWhen: {
        and: [
          { "==": [{ var: "type" }, "shift"] },
          { "!!": { var: "successor" } },
        ],
      },
    });
    expect(JSON.stringify(steps[1])).toContain("form-field:branch");
    // 店長自己交班(沒有接班人)或送日結:照常審核,派給他自己再檢查一次(不自動通過、不剔除)
    expect(steps[1]).toMatchObject({ autoApprove: { applicant: "review" } });
    expect(steps[0]).not.toHaveProperty("autoApprove");
  });

  it("店員可以送結帳確認申請(store.create-checkout_confirm)", () => {
    expect(roleGrantOf("clerk", ROLE_GRANT_SECTIONS).permissionKeys).toContain(
      CHECKOUT_CREATE_PERMISSION,
    );
  });
});
