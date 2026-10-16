import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import type { FormDefinition } from "@repo/domain/form";

import {
  DEMO_FORM_ROUTES,
  SHOPPING_FORM_KEY,
  field,
  shoppingDefinition,
} from "@/test/msw/form-fixtures";
import type { FormRuntimeWorldOptions } from "@/test/msw/form-runtime-handlers";

import {
  defaultRuntimeOptions,
  renderShopping,
} from "./form-module-test-support";

const CREATE_PATH = `${DEMO_FORM_ROUTES.createPage}/shopping_list`;

/** 購物單多一個必填的是 / 否欄位「同意條款」(勾選框)。 */
const withAgreement = (): FormDefinition => {
  const definition = shoppingDefinition();
  definition.fields.push(
    field("agree", "同意條款", "boolean", {
      widget: { kind: "checkbox" },
      rules: { required: true },
    }),
  );
  definition.layout.sections[0]?.rows.push({
    cols: [{ fieldKey: "agree", span: 12 }],
  });
  return definition;
};

const worldOf = (
  extra: Partial<FormRuntimeWorldOptions> = {},
): FormRuntimeWorldOptions => ({
  ...defaultRuntimeOptions(),
  versions: { [`${SHOPPING_FORM_KEY}@1`]: withAgreement() },
  ...extra,
});

describe("表單模組:是 / 否欄位必填 = 必須勾選", () => {
  it("沒勾:勾選框標成必填;送出被 api 以必填擋下,錯誤顯示在該欄", async () => {
    const { user } = renderShopping({
      path: CREATE_PATH,
      world: worldOf({
        failures: {
          SubmitFormSubmission: {
            code: "VALIDATION_FAILED",
            extensions: {
              fieldErrors: [
                {
                  fieldKey: "agree",
                  code: "REQUIRED",
                  message: "「同意條款」必須勾選",
                },
              ],
            },
          },
        },
      }),
    });

    const agree = await screen.findByRole("checkbox", { name: /同意條款/ });
    expect(agree).toBeRequired();
    expect(agree).not.toBeChecked();
    await user.type(screen.getByRole("textbox", { name: "品項" }), "牛奶");
    await user.click(screen.getByRole("button", { name: "送出" }));

    expect(await screen.findByText("「同意條款」必須勾選")).toBeInTheDocument();
  });

  it("勾了:送出的值是 true(布林),照常送出", async () => {
    const { user, world } = renderShopping({
      path: CREATE_PATH,
      world: worldOf(),
    });

    await user.type(await screen.findByRole("textbox", { name: "品項" }), "蛋");
    await user.click(screen.getByRole("checkbox", { name: /同意條款/ }));
    await user.click(screen.getByRole("button", { name: "送出" }));

    await waitFor(() => {
      expect(world.inputs.submitFormSubmission).toHaveLength(1);
    });
    expect(world.inputs.createFormDraft[0]?.values).toMatchObject({
      agree: true,
    });
  });
});
