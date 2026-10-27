import { beforeEach, describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { STORE_KEY } from "@repo/domain/project/lottery";

import {
  shoppingDefinition,
  submissionFragment,
} from "@/test/msw/form-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import { renderStore } from "../store-test-support";

setupFakeViewport();

/** 租戶自己綁到店面管理的表單(借示範的購物單定義)。 */
const REPAIR_FORM_KEY = "repair_request";

const repairForm = {
  key: REPAIR_FORM_KEY,
  name: "設備報修單",
  moduleKey: STORE_KEY,
  currentVersion: 1,
  tabLabelTemplate: null,
  allowDraft: true,
  canCreate: true,
};

const renderOtherForms = () =>
  renderStore({
    path: "/store?tab=other-forms",
    formRuntime: {
      moduleForms: [repairForm],
      versions: { [`${REPAIR_FORM_KEY}@1`]: shoppingDefinition() },
      submissions: [
        submissionFragment({
          id: "sub-repair-1",
          moduleKey: STORE_KEY,
          formKey: REPAIR_FORM_KEY,
          formName: "設備報修單",
          summary: { title: "冷氣漏水", date: null, amount: null },
        }),
      ],
    },
  });

/**
 * 店面管理 →「其他申請」(規格 6.1):只列租戶自己綁的表單;內建的撤銷售出申請、現金更正單、
 * 盤點確認申請、結帳確認申請不出現在列表、表單篩選與 [+ 新增](結帳確認申請的新增頁要帶班次)。
 */
describe("店面管理:其他申請排除內建表單", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("列表只有租戶的表單;api 查詢帶排除條件;表單篩選沒有內建四張", async () => {
    const { user, runtime } = renderOtherForms();
    const table = await screen.findByRole(
      "table",
      { name: "店面管理清單" },
      { timeout: 10_000 },
    );
    expect(
      await within(table).findByRole("cell", { name: "設備報修單" }),
    ).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(runtime.inputs.formSubmissions.at(-1)?.excludeFormKeys).toEqual([
      "sale_reversal",
      "cash_correction",
      "stocktake_confirm",
      "checkout_confirm",
    ]);

    await user.click(screen.getByRole("combobox", { name: "表單" }));
    const options = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toContain("設備報修單");
    for (const builtin of [
      "撤銷售出申請",
      "現金更正單",
      "盤點確認申請",
      "結帳確認申請",
    ]) {
      expect(options).not.toContain(builtin);
    }
  });

  it("[+ 新增] 只剩租戶的表單一張 → 直接進它的新增頁(不出現內建表單)", async () => {
    const { user } = renderOtherForms();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "+ 新增" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "+ 新增" }));
    expect(
      await screen.findByRole("heading", { name: "新增 — 設備報修單" }),
    ).toBeInTheDocument();
  });
});
