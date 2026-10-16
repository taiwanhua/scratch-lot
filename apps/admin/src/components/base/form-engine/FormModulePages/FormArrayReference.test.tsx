import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import type { FormDefinition } from "@repo/domain/form";

import { DEMO_FORM_ROUTES, SHOPPING_FORM_KEY } from "@/test/msw/form-fixtures";

import { arrayDefinition, lineRow } from "./form-array-test-support";
import { renderShopping, shoppingForm } from "./form-module-test-support";

const CREATE_PATH = `${DEMO_FORM_ROUTES.createPage}/shopping_list`;

/** 購物單的明細多一個引用子欄「經手人」(使用者)。 */
const referenceDefinition = (): FormDefinition => {
  const base = arrayDefinition();
  return {
    ...base,
    fields: base.fields.map((candidate) =>
      candidate.key === "lines"
        ? {
            ...candidate,
            columns: [
              ...(candidate.columns ?? []),
              {
                key: "who",
                label: "經手人",
                type: "reference",
                widget: { kind: "referencePicker" },
                valueSource: { kind: "input" },
                source: { provider: "user", labelField: "name" },
              },
            ],
          }
        : candidate,
    ),
  };
};

/** 明細子欄支援引用(《底座規格》3.2 B2b):表格格子是自動完成,查詢目標是 `<明細 key>.<子欄 key>`。 */
describe("明細列的引用子欄(填寫)", () => {
  it("格子是自動完成;查 `lines.who`,選定後存 `{ id, label }`", async () => {
    const { user, world } = renderShopping({
      path: CREATE_PATH,
      world: {
        moduleForms: [shoppingForm],
        versions: { [`${SHOPPING_FORM_KEY}@1`]: referenceDefinition() },
        lookupRecords: [
          { id: "user-9", value: "user-9", label: "阿明", values: {} },
        ],
      },
    });
    await user.type(
      await screen.findByRole("textbox", { name: "品項" }),
      "採買",
    );
    await user.click(await screen.findByRole("button", { name: "+ 新增一列" }));
    const row = within(lineRow(0));
    await user.type(row.getByRole("textbox", { name: "品名" }), "蘋果");
    await user.click(row.getByRole("combobox", { name: "經手人" }));
    await user.click(await screen.findByRole("option", { name: "阿明" }));

    expect(world.inputs.formLookup).toContainEqual(
      expect.objectContaining({ target: { fieldKey: "lines.who" } }),
    );
    await user.click(screen.getByRole("button", { name: "送出" }));
    await waitFor(() => {
      expect(world.inputs.createFormDraft).toHaveLength(1);
    });
    const lines = world.inputs.createFormDraft[0]?.values?.lines as {
      who: unknown;
    }[];
    expect(lines[0]?.who).toEqual({ id: "user-9", label: "阿明" });
  });
});
