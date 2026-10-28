import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { authWorld } from "@/test/msw/auth-handlers";
import {
  DEMO_FORM_KEY,
  SHOPPING_FORM_KEY,
  demoFormModules,
  shoppingDefinition,
  submissionFragment,
} from "@/test/msw/form-fixtures";
import { formRuntimeWorld } from "@/test/msw/form-runtime-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";
import { setupFakeViewport } from "@/test/viewport";

import { FormListPage } from "./FormListPage";
import { SHOPPING_ALL, shoppingForm } from "./form-module-test-support";

setupFakeViewport();

/** 組裝頁另外呈現、這一頁不處理的表單(借示範的購物單定義)。 */
const EXCLUDED_FORM_KEY = "shopping_list_builtin";

const excludedForm = {
  ...shoppingForm,
  key: EXCLUDED_FORM_KEY,
  name: "購物單(另頁處理)",
};

/**
 * 組裝頁直接用 `FormListPage` 並帶 `excludeFormKeys`(例:模組裡有幾張表單由別的分頁處理)。
 * 首頁旁掛這一頁(`extra`),不經模組路由的預設組裝。
 */
const renderExcluding = () => {
  const [listModule] = demoFormModules(SHOPPING_ALL);
  const runtime = formRuntimeWorld({
    moduleForms: [shoppingForm, excludedForm],
    versions: {
      [`${SHOPPING_FORM_KEY}@1`]: shoppingDefinition(),
      [`${EXCLUDED_FORM_KEY}@1`]: shoppingDefinition(),
    },
    submissions: [
      submissionFragment(),
      submissionFragment({
        id: "sub-excluded",
        formKey: EXCLUDED_FORM_KEY,
        formName: "購物單(另頁處理)",
        summary: { title: "牛奶", date: null, amount: null },
      }),
    ],
  });
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      modules: demoFormModules(SHOPPING_ALL),
    }).handlers,
    ...runtime.handlers,
  );
  return {
    ...renderApp({
      path: "/",
      extra: (
        <FormListPage
          module={listModule}
          excludeFormKeys={[EXCLUDED_FORM_KEY]}
        />
      ),
    }),
    runtime,
  };
};

describe("表單模組列表頁:排除組裝頁另外呈現的表單(excludeFormKeys)", () => {
  it("列表不列排除的表單;api 查詢帶排除條件;表單篩選沒有它", async () => {
    const { user, runtime } = renderExcluding();
    const grid = await screen.findByRole(
      "table",
      { name: "示範表單(頂層)清單" },
      { timeout: 10_000 },
    );
    expect(await within(grid).findByText("雞蛋")).toBeInTheDocument();
    expect(within(grid).queryByText("牛奶")).not.toBeInTheDocument();
    expect(runtime.inputs.formSubmissions.at(-1)?.excludeFormKeys).toEqual([
      EXCLUDED_FORM_KEY,
    ]);

    await user.click(screen.getByRole("combobox", { name: "表單" }));
    const options = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toContain("購物單");
    expect(options).not.toContain("購物單(另頁處理)");
  });

  it("[+ 新增] 只剩一張可新增的表單 → 直接進它的新增頁(不出現選表單)", async () => {
    const { user } = renderExcluding();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "+ 新增" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "+ 新增" }));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/${DEMO_FORM_KEY}/create-page/${SHOPPING_FORM_KEY}`,
      );
    });
    expect(
      screen.queryByRole("dialog", { name: "選擇要填寫的表單" }),
    ).not.toBeInTheDocument();
  });
});
