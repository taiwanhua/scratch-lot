import { describe, expect, it } from "@jest/globals";
import { screen } from "@testing-library/react";

import { authWorld } from "@/test/msw/auth-handlers";
import {
  DEMO_FORM_KEY,
  DEMO_FORM_ROUTES,
  SHOPPING_FORM_KEY,
  demoFormModules,
} from "@/test/msw/form-fixtures";
import {
  type FormRuntimeWorldOptions,
  formRuntimeWorld,
} from "@/test/msw/form-runtime-handlers";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/render";

import {
  SHOPPING_ALL,
  defaultRuntimeOptions,
  shoppingForm,
} from "./form-module-test-support";
import { useFormEntry } from "./useFormEntry";

/** 探針:把 `useFormEntry` 的結果寫成文字(掛在路由旁)。 */
const Probe = ({ formKey }: { formKey: string }) => {
  const entry = useFormEntry(DEMO_FORM_KEY, formKey);
  if (entry.isLoading) {
    return <p>載入中</p>;
  }
  return (
    <dl>
      <dt>form</dt>
      <dd data-testid="form">{entry.form?.name ?? "none"}</dd>
      <dt>canCreate</dt>
      <dd data-testid="can-create">{String(entry.canCreate)}</dd>
      <dt>href</dt>
      <dd data-testid="href">{entry.createHref() ?? "null"}</dd>
      <dt>hrefWithQuery</dt>
      <dd data-testid="href-query">
        {entry.createHref(new URLSearchParams({ from: "A-1" })) ?? "null"}
      </dd>
    </dl>
  );
};

const renderProbe = (
  formKey: string,
  {
    permissions = SHOPPING_ALL,
    world = defaultRuntimeOptions(),
  }: {
    permissions?: readonly string[];
    world?: FormRuntimeWorldOptions;
  } = {},
) => {
  server.use(
    ...authWorld({
      hasRefreshCookie: true,
      modules: demoFormModules(permissions),
    }).handlers,
    ...formRuntimeWorld(world).handlers,
  );
  return renderApp({
    path: "/overview",
    extra: <Probe formKey={formKey} />,
  });
};

describe("useFormEntry(模組裡指定一張表單的入口)", () => {
  it("可新增的表單:找得到表單、可新增、新增頁網址 = 新增頁路由/表單代號(可帶 query)", async () => {
    renderProbe(SHOPPING_FORM_KEY);
    expect(await screen.findByTestId("form")).toHaveTextContent(
      shoppingForm.name,
    );
    expect(screen.getByTestId("can-create")).toHaveTextContent("true");
    expect(screen.getByTestId("href")).toHaveTextContent(
      `${DEMO_FORM_ROUTES.createPage}/${SHOPPING_FORM_KEY}`,
    );
    expect(screen.getByTestId("href-query")).toHaveTextContent(
      `${DEMO_FORM_ROUTES.createPage}/${SHOPPING_FORM_KEY}?from=A-1`,
    );
  });

  it("這張表單沒有新增權限(api canCreate false):找不到表單、不可新增,網址照樣組得出來", async () => {
    renderProbe(SHOPPING_FORM_KEY, {
      world: {
        ...defaultRuntimeOptions(),
        moduleForms: [{ ...shoppingForm, canCreate: false }],
      },
    });
    expect(await screen.findByTestId("form")).toHaveTextContent("none");
    expect(screen.getByTestId("can-create")).toHaveTextContent("false");
    expect(screen.getByTestId("href")).toHaveTextContent(
      `${DEMO_FORM_ROUTES.createPage}/${SHOPPING_FORM_KEY}`,
    );
  });

  it("模組裡沒有這張表單 → 不可新增", async () => {
    renderProbe("other_form");
    expect(await screen.findByTestId("form")).toHaveTextContent("none");
    expect(screen.getByTestId("can-create")).toHaveTextContent("false");
  });
});
