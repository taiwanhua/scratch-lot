import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import { CASH_CORRECTION_FORM_KEY } from "@repo/domain/project/lottery";

import { renderStore } from "../store-test-support";

const STORE_A = "org-store-a";
const STORE_B = "org-store-b";

const LOOKUP_RECORDS = [
  { id: STORE_A, value: STORE_A, label: "中山店", values: {} },
  { id: STORE_B, value: STORE_B, label: "信義店", values: {} },
  {
    id: "shift-counter",
    value: "shift-counter",
    label: "店內櫃台 · 王小明 10/21 13:00",
    values: {},
  },
];

/** 現金更正單(規格 8.8)的「班次」:預設 = 填寫者自己在「分店」那家店開著的班。 */
describe("現金更正單:班次預設為自己目前的班", () => {
  it("選了分店就帶入自己在那家店開著的班;換到沒開班的店 → 空", async () => {
    const { user, runtime } = renderStore({
      path: `/store/create-page/${CASH_CORRECTION_FORM_KEY}?org=${STORE_A}`,
      formRuntime: {
        lookupRecords: LOOKUP_RECORDS,
        lookupDefault: (input) =>
          input.fieldKey === "shift" && input.filterValues?.branch === STORE_A
            ? "shift-counter"
            : null,
      },
    });

    await user.click(
      await screen.findByRole("radio", { name: "某一班的抽屜" }),
    );
    await user.click(screen.getByRole("combobox", { name: "分店" }));
    await user.click(await screen.findByRole("option", { name: "中山店" }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "班次" })).toHaveValue(
        "店內櫃台 · 王小明 10/21 13:00",
      );
    });
    expect(runtime.inputs.formLookupDefault).toContainEqual(
      expect.objectContaining({
        formKey: CASH_CORRECTION_FORM_KEY,
        fieldKey: "shift",
        filterValues: { branch: STORE_A },
      }),
    );

    await user.click(screen.getByRole("combobox", { name: "分店" }));
    await user.click(await screen.findByRole("option", { name: "信義店" }));
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "班次" })).toHaveValue("");
    });
  });
});
