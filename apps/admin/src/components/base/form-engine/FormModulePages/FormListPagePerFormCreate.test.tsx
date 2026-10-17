import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { DEMO_FORM_ROUTES } from "@/test/msw/form-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import {
  defaultRuntimeOptions,
  renderShopping,
  shoppingForm,
} from "./form-module-test-support";

setupFakeViewport();

/** 新增鈕在「此刻可新增的表單」回來之前不出現;等它出現且可按再點。 */
const createButton = async () => {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "+ 新增" })).toBeEnabled();
  });
  return screen.getByRole("button", { name: "+ 新增" });
};

const table = () =>
  screen.findByRole(
    "table",
    { name: "示範表單(頂層)清單" },
    { timeout: 10_000 },
  );

describe("依表單分開新增權限(B9b):[+ 新增] 只列有新增權限的表單(api `canCreate`)", () => {
  const store = {
    ...shoppingForm,
    key: "shopping_list_store",
    name: "購物單(門市版)",
  };
  const locked = {
    ...shoppingForm,
    key: "shopping_list_locked",
    name: "採購單(沒有新增權限)",
    canCreate: false,
  };

  it("多張可新增:FormPicker 只列可新增的,沒有新增權限的不出現", async () => {
    const { user } = renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: {
        ...defaultRuntimeOptions(),
        moduleForms: [shoppingForm, locked, store],
      },
    });

    await user.click(await createButton());
    const picker = await screen.findByRole("dialog", {
      name: "選擇要填寫的表單",
    });
    expect(within(picker).getByText("購物單")).toBeInTheDocument();
    expect(within(picker).getByText("購物單(門市版)")).toBeInTheDocument();
    expect(within(picker).queryByText("採購單(沒有新增權限)")).toBeNull();
  });

  it("只剩一張可新增:按新增直接進那一張(不先選)", async () => {
    const { user } = renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: {
        ...defaultRuntimeOptions(),
        moduleForms: [locked, shoppingForm],
      },
    });

    await user.click(await createButton());

    expect(
      await screen.findByRole("heading", { name: "新增 — 購物單" }),
    ).toBeInTheDocument();
  });

  it("有表單但一張都不能新增(只有模組 `create`):不出現新增鈕", async () => {
    const { user } = renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: { ...defaultRuntimeOptions(), moduleForms: [locked] },
    });

    await table();
    // 等表單清單回來(篩選下拉列得出那張表單)再看:一張都不能新增 → 新增鈕不出現
    await user.click(screen.getByRole("combobox", { name: "表單" }));
    expect(
      await screen.findByRole("option", { name: "採購單(沒有新增權限)" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ 新增" })).toBeNull();
  });
});
