import { describe, expect, it } from "@jest/globals";

import { VOID_REASON_CATEGORY_KEY } from "@repo/domain/form";
import {
  STOCKTAKE_CONFIRM_FORM_KEY,
  STOCKTAKE_FIELD_KEYS,
  STORE_KEY,
} from "@repo/domain/project/lottery";

import { assembleSeedRegistry } from "../registry";
import { FORM_WORKFLOWS } from "./onboarding/form-workflows";
import { ROLE_GRANT_SECTIONS } from "./onboarding/role-grants";
import { roleGrantOf } from "./onboarding/roles";
import { projectSeedSource } from "./registry";
import { seed as stocktakeForm } from "./revisions/stocktake_confirm.r3.seed";
import { projectSeedSettings } from "./settings";

const fieldOf = (key: string) =>
  stocktakeForm.definition.fields.find((field) => field.key === key);

/** 盤點確認申請的受管表單(規格 8.6;正本 `docs/modules/project/store.md`「盤點」)。 */
describe("受管表單 盤點確認申請(stocktake_confirm r1)", () => {
  it("登記進專案來源,與底座一起組裝不衝突(定義檢查與可攜性檢查都過)", () => {
    expect(projectSeedSource.seeds).toContain(stocktakeForm);
    expect(() =>
      assembleSeedRegistry(projectSeedSettings, projectSeedSource),
    ).not.toThrow();
  });

  it("綁在店面管理、沒有草稿、單號 ST-0001、作廢原因 = 共用的「作廢原因」(作廢由掛接點一律擋下)", () => {
    expect(stocktakeForm).toMatchObject({
      key: STOCKTAKE_CONFIRM_FORM_KEY,
      moduleKey: STORE_KEY,
      allowDraft: false,
      voidReasonCategoryKey: VOID_REASON_CATEGORY_KEY,
      // 依欄位共用:分店欄指到的分店也看得到(唯讀)
      sharedByFieldKeys: ["branch"],
      serial: { prefix: "ST", period: "none", digits: 4 },
    });
  });

  it("欄位 key 對得上程式(分店、盤點範圍、彙總、說明);盤點內容唯讀時不顯示", () => {
    for (const key of Object.values(STOCKTAKE_FIELD_KEYS)) {
      expect(fieldOf(key)).toBeDefined();
    }
    expect(fieldOf(STOCKTAKE_FIELD_KEYS.branch)).toMatchObject({
      type: "reference",
      source: { provider: "org" },
    });
    expect(fieldOf(STOCKTAKE_FIELD_KEYS.draft)?.widget).toMatchObject({
      hideWhenReadonly: true,
    });
  });
});

describe("開通(規格 2.1、3.3)", () => {
  it("流程一關:店長限定「分店」,申請人是審核者時自動通過(B5)", () => {
    const spec = FORM_WORKFLOWS.find(
      (item) => item.formKey === STOCKTAKE_CONFIRM_FORM_KEY,
    );
    expect(spec).toBeDefined();
    const steps =
      spec?.steps({
        state: { roleIds: new Map([["store-manager", "role-1"]]) },
      } as never) ?? [];
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ autoApprove: { applicant: true } });
    expect(JSON.stringify(steps[0])).toContain("form-field:branch");
  });

  it("店員可以送盤點確認申請(store.create-stocktake_confirm)", () => {
    expect(roleGrantOf("clerk", ROLE_GRANT_SECTIONS).permissionKeys).toContain(
      `${STORE_KEY}.create-${STOCKTAKE_CONFIRM_FORM_KEY}`,
    );
  });
});
