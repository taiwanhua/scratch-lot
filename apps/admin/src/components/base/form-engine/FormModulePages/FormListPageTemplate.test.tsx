import { describe, expect, it } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";

import { type ModuleListColumn, ModuleListColumnKind } from "@repo/graphql";

import {
  DEMO_FORM_KEY,
  DEMO_FORM_ROUTES,
  submissionFragment,
} from "@/test/msw/form-fixtures";
import { setupFakeViewport } from "@/test/viewport";

import {
  defaultRuntimeOptions,
  renderShopping,
} from "./form-module-test-support";

setupFakeViewport();

const table = () =>
  screen.findByRole(
    "table",
    { name: "示範表單(頂層)清單" },
    { timeout: 10_000 },
  );

const templateColumn = (
  key: string,
  label: string,
  order: number,
  formKey: string | null = null,
): ModuleListColumn => ({
  kind: ModuleListColumnKind.Template,
  key,
  label,
  formKey,
  width: 240,
  order,
});

const rowOf = async (text: string) => {
  const grid = await table();
  const cell = await within(grid).findByText(text);
  const row = cell.closest("tr");
  expect(row).not.toBeNull();
  return row as HTMLElement;
};

describe("表單模組列表頁:組合欄", () => {
  it("表頭是配置的欄名;一格依那一筆的值組字串,佔位符照表單欄位欄的顯示規則(數字帶單位)", async () => {
    renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: {
        ...defaultRuntimeOptions(),
        submissions: [submissionFragment({ serialNo: "PU-0001" })],
        listColumns: {
          [DEMO_FORM_KEY]: [
            templateColumn(
              "{{serialNo}} {{value.item}} × {{value.qty}}({{value.total}})",
              "品項摘要",
              0,
            ),
          ],
        },
      },
    });

    const grid = await table();
    expect(
      await within(grid).findByRole("columnheader", { name: /品項摘要/ }),
    ).toBeInTheDocument();
    expect(
      await within(grid).findByText("PU-0001 雞蛋 × 2(60 元)"),
    ).toBeInTheDocument();
  });

  it("讀不到的欄位(api 遮蔽成 [redacted])與沒值的佔位符換成空白、不露原值;整格都空顯示「—」", async () => {
    renderShopping({
      path: DEMO_FORM_ROUTES.list,
      world: {
        ...defaultRuntimeOptions(),
        submissions: [
          submissionFragment({
            serialNo: null,
            values: {
              ...submissionFragment().values,
              internal_note: "[redacted]",
            },
          }),
        ],
        listColumns: {
          [DEMO_FORM_KEY]: [
            templateColumn("{{value.item}}/{{value.internal_note}}", "品項", 0),
            templateColumn(
              "{{serialNo}}{{value.internal_note}}{{value.buyer}}",
              "全空",
              1,
            ),
            // 限定別張表單:這一筆不是那張表單 →「—」
            templateColumn("{{value.item}}", "別張表單", 2, "other_form"),
          ],
        },
      },
    });

    const row = await rowOf("雞蛋/");
    expect(within(row).queryByText(/redacted/)).toBeNull();
    await waitFor(() => {
      expect(within(row).getAllByText("—")).toHaveLength(2);
    });
  });
});
