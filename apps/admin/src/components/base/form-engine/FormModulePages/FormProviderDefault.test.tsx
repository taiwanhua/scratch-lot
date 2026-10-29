import { describe, expect, it } from "@jest/globals";
import { screen, waitFor } from "@testing-library/react";

import type { FormDefinition } from "@repo/domain/form";

import {
  DEMO_FORM_ROUTES,
  SHOPPING_FORM_KEY,
  field,
} from "@/test/msw/form-fixtures";

import { renderShopping, shoppingForm } from "./form-module-test-support";

const CREATE_PATH = `${DEMO_FORM_ROUTES.createPage}/shopping_list`;

/** 「站點」選組織;「時段」= 來源提供的預設,條件「組織 = 站點」(那個站點裡自己的那一筆)。 */
const providerDefinition = (): FormDefinition => ({
  fields: [
    field("item", "品項", "text"),
    field("site", "站點", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "org", labelField: "name" },
    }),
    field("slot", "時段", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "project_slot", labelField: "name" },
      default: { kind: "provider", filter: { orgId: { var: "site" } } },
    }),
  ],
  layout: {
    sections: [
      {
        key: "basic",
        title: "基本資料",
        rows: [
          { cols: [{ fieldKey: "item", span: 12 }] },
          { cols: [{ fieldKey: "site", span: 6 }] },
          { cols: [{ fieldKey: "slot", span: 6 }] },
        ],
      },
    ],
  },
  summaryMap: { title: "item" },
  prefills: [],
});

const LOOKUP_RECORDS = [
  { id: "org-a", value: "org-a", label: "A 站", values: {} },
  { id: "org-b", value: "org-b", label: "B 站", values: {} },
  { id: "slot-a", value: "slot-a", label: "A 站的時段", values: {} },
  { id: "slot-other", value: "slot-other", label: "別的時段", values: {} },
];

/** 假 api:A 站有自己的時段、B 站沒有。 */
const DEFAULTS: Record<string, string | null> = {
  "org-a": "slot-a",
  "org-b": null,
};

const renderProvider = () =>
  renderShopping({
    path: CREATE_PATH,
    world: {
      moduleForms: [shoppingForm],
      versions: { [`${SHOPPING_FORM_KEY}@1`]: providerDefinition() },
      lookupRecords: LOOKUP_RECORDS,
      lookupDefault: (input) => {
        const site = input.filterValues?.site;
        return typeof site === "string" ? (DEFAULTS[site] ?? null) : null;
      },
    },
  });

const pick = async (
  user: ReturnType<typeof renderProvider>["user"],
  name: string,
  label: string,
) => {
  await user.click(screen.getByRole("combobox", { name }));
  await user.click(await screen.findByRole("option", { name: label }));
};

describe("引用欄「來源提供的預設」(填寫)", () => {
  it("條件沒填不查;填了站點就查回那個站點裡自己的、換站點跟著重查;碰過就停", async () => {
    const { user, world } = renderProvider();
    const slot = await screen.findByRole("combobox", { name: "時段" });
    expect(slot).toHaveValue("");
    expect(world.inputs.formLookupDefault).toEqual([]);

    await pick(user, "站點", "A 站");
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "時段" })).toHaveValue(
        "A 站的時段",
      );
    });
    expect(world.inputs.formLookupDefault).toContainEqual({
      formKey: SHOPPING_FORM_KEY,
      version: 1,
      fieldKey: "slot",
      filterValues: { site: "org-a" },
    });

    // B 站沒有自己的 → 空
    await pick(user, "站點", "B 站");
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "時段" })).toHaveValue("");
    });

    // 使用者自己選了之後,站點再換也不動
    await pick(user, "時段", "別的時段");
    await pick(user, "站點", "A 站");
    expect(screen.getByRole("combobox", { name: "時段" })).toHaveValue(
      "別的時段",
    );

    await user.type(screen.getByRole("textbox", { name: "品項" }), "測試");
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await waitFor(() => {
      expect(world.inputs.createFormDraft).toHaveLength(1);
    });
    const [input] = world.inputs.createFormDraft;
    expect(input.values).toMatchObject({
      site: { id: "org-a" },
      slot: { id: "slot-other" },
    });
    expect(input.touched).toEqual(expect.arrayContaining(["site", "slot"]));
  });

  it("沒碰過就送出:帶的是查回來的值(含顯示名)", async () => {
    const { user, world } = renderProvider();
    await user.type(
      await screen.findByRole("textbox", { name: "品項" }),
      "測試",
    );
    await pick(user, "站點", "A 站");
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "時段" })).toHaveValue(
        "A 站的時段",
      );
    });
    await user.click(screen.getByRole("button", { name: "存草稿" }));
    await waitFor(() => {
      expect(world.inputs.createFormDraft).toHaveLength(1);
    });
    const [input] = world.inputs.createFormDraft;
    expect(input.values).toMatchObject({
      slot: { id: "slot-a", label: "A 站的時段" },
    });
    expect(input.touched).not.toContain("slot");
  });
});
