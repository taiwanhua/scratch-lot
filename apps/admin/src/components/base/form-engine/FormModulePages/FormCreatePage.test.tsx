import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { DEMO_FORM_ROUTES } from "@/test/msw/form-fixtures";

import {
  SHOPPING_ACTIONS,
  defaultRuntimeOptions,
  renderShopping,
} from "./form-module-test-support";

const CREATE_PATH = `${DEMO_FORM_ROUTES.createPage}/shopping_list`;

describe("表單模組新增頁(預設組裝)", () => {
  it("一顆「送出」= 建草稿(帶 clientRequestId)+ 送出;計算欄位即時算,條件即時套", async () => {
    const { user, world } = renderShopping({ path: CREATE_PATH });

    const item = await screen.findByRole("textbox", { name: "品項" });
    // 數量還沒填:「備註」的顯示條件(數量 > 0)不成立,整欄不渲染
    expect(screen.queryByRole("textbox", { name: "備註" })).toBeNull();

    await user.type(item, "牛奶");
    await user.type(screen.getByRole("textbox", { name: "數量" }), "3");
    await user.type(screen.getByRole("textbox", { name: "單價" }), "40");

    // 計算欄位是有框的唯讀輸入框(不能改),填完依賴就算出來
    expect(await screen.findByDisplayValue("120 元")).toBeInTheDocument();
    const total = screen.getByRole("textbox", { name: "總價" });
    expect(total).toHaveValue("120 元");
    expect(total).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "備註" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "送出" }));

    await waitFor(() => {
      expect(world.inputs.submitFormSubmission).toHaveLength(1);
    });
    const draft = world.inputs.createFormDraft[0];
    expect(draft.formKey).toBe("shopping_list");
    expect(draft.clientRequestId).toMatch(/[0-9a-f-]{36}/);
    expect(draft.values).toMatchObject({
      item: "牛奶",
      qty: "3",
      unit_price: "40",
    });
    // 計算欄位由後端算,前端不送它的值
    expect(draft.values).not.toHaveProperty("total");
    expect(world.inputs.submitFormSubmission[0]?.expectedEditVersion).toBe(1);
    // 送出後到詳情頁
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `${DEMO_FORM_ROUTES.viewPage}/sub-new-1`,
      );
    });
  });

  it("存草稿兩次:第一次建草稿、第二次存同一筆(同一個 clientRequestId 只建一次)", async () => {
    const { user, world } = renderShopping({ path: CREATE_PATH });

    await user.type(await screen.findByRole("textbox", { name: "品項" }), "蛋");
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await waitFor(() => {
      expect(world.inputs.createFormDraft).toHaveLength(1);
    });
    await user.click(screen.getByRole("button", { name: "存草稿" }));

    await waitFor(() => {
      expect(world.inputs.saveFormDraft).toHaveLength(1);
    });
    expect(world.inputs.createFormDraft).toHaveLength(1);
    expect(world.inputs.saveFormDraft[0]).toMatchObject({
      id: "sub-new-1",
      expectedEditVersion: 1,
    });
  });

  it("帶入資料:沒有 edit 資格的欄位那一列不出現;勾選的欄位帶進表單", async () => {
    const { user } = renderShopping({
      path: CREATE_PATH,
      // 內部備註設了「限定可改」:四個動作都有、但沒有 edit-shopping_list-internal_note(也沒有 `*`)就沒有帶入資格
      permissions: SHOPPING_ACTIONS,
      world: {
        ...defaultRuntimeOptions(),
        lookupRecords: [
          {
            id: "user-9",
            value: "user-9",
            label: "阿明",
            values: { name: "阿明", email: "ming@cookhome.test" },
          },
        ],
      },
    });

    // 「帶入資料」與標題同一列(標題列右側)
    const prefill = await screen.findByRole("button", { name: "帶入資料" });
    const title = screen.getByRole("heading", { name: "新增 — 購物單" });
    expect(title.parentElement).toContainElement(prefill);
    expect(
      title.compareDocumentPosition(prefill) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(prefill);
    const dialog = await screen.findByRole("dialog", { name: "帶入資料" });
    await user.click(await within(dialog).findByText("阿明"));

    const mapping = within(dialog).getByRole("group", { name: "要帶入的欄位" });
    expect(within(mapping).getByText("採購人 ← name:阿明")).toBeInTheDocument();
    expect(within(mapping).queryByText(/內部備註/)).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "帶入" }));

    expect(await screen.findByRole("textbox", { name: "採購人" })).toHaveValue(
      "阿明",
    );
  });
});
