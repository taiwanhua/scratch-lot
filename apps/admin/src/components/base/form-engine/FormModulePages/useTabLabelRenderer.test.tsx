import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react";

import { FormModuleOptionsContext } from "@/hooks/base/useFormModuleOptions";
import { composeFormModuleOptions } from "@/lib/base/form-engine/form-module-options";
import { authWorld } from "@/test/msw/auth-handlers";
import {
  DEMO_FORM_KEY,
  SHOPPING_FORM_KEY,
  demoFormModules,
} from "@/test/msw/form-fixtures";
import { formRuntimeWorld } from "@/test/msw/form-runtime-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import {
  defaultRuntimeOptions,
  shoppingForm,
} from "./form-module-test-support";
import { useTabLabelRenderer } from "./useTabLabelRenderer";

/** 以表單頁實際的算法算一筆的頁籤標題。 */
const TabLabelProbe = () => {
  const tabLabelOf = useTabLabelRenderer({
    moduleKey: DEMO_FORM_KEY,
    formKey: SHOPPING_FORM_KEY,
    formName: shoppingForm.name,
    definition: null,
    action: "view",
  });
  return <output aria-label="頁籤標題">{tabLabelOf({}) ?? "(載入中)"}</output>;
};

describe("頁籤模板的優先序:表單自己的模板 → 模組層模板(經 context 注入)", () => {
  const moduleTemplate = "{{action}}/{{form}}/{{module}}";
  const options = composeFormModuleOptions([
    { moduleKey: DEMO_FORM_KEY, options: { tabLabelTemplate: moduleTemplate } },
  ]);

  const renderProbe = (formTemplate: string | null) => {
    server.use(
      ...authWorld({
        hasRefreshCookie: true,
        modules: demoFormModules([`${DEMO_FORM_KEY}.*`]),
      }).handlers,
      ...formRuntimeWorld({
        ...defaultRuntimeOptions(),
        moduleForms: [{ ...shoppingForm, tabLabelTemplate: formTemplate }],
      }).handlers,
    );
    renderApp({
      path: "/change-password",
      // 探針掛在路由旁、內層再供給一份設定:最近的那一份生效,不受外層正式組裝影響
      extra: (
        <FormModuleOptionsContext.Provider value={options}>
          <TabLabelProbe />
        </FormModuleOptionsContext.Provider>
      ),
    });
  };

  it("表單沒有自己的模板:用登記的模組層模板", async () => {
    renderProbe(null);

    expect(
      await screen.findByText("檢視/購物單/示範表單(頂層)"),
    ).toBeInTheDocument();
  });

  it("表單有自己的模板:表單的優先", async () => {
    renderProbe("{{form}}的{{action}}");

    expect(await screen.findByText("購物單的檢視")).toBeInTheDocument();
  });
});
