import { describe, expect, it } from "@jest/globals";
import { screen, within } from "@testing-library/react";

import type { FormDefinition } from "@repo/domain/form";

import {
  DEMO_FORM_ROUTES,
  SHOPPING_FORM_KEY,
  shoppingDefinition,
  submissionFragment,
} from "@/test/msw/form-fixtures";

import { renderShopping, shoppingForm } from "./form-module-test-support";

const EARLY = "2026-01-05T02:00:00.000Z";

/** 第 1 版:品項叫「品項(舊)」,還有備註。 */
const versionOne = (): FormDefinition => {
  const definition = shoppingDefinition();
  return {
    ...definition,
    fields: definition.fields.map((field) =>
      field.key === "item" ? { ...field, label: "品項(舊)" } : field,
    ),
  };
};

/** 第 2 版(升級到的版本):品項改叫「品名」、拿掉備註。 */
const versionTwo = (): FormDefinition => {
  const definition = shoppingDefinition();
  return {
    ...definition,
    fields: definition.fields
      .filter((field) => field.key !== "note")
      .map((field) =>
        field.key === "item" ? { ...field, label: "品名" } : field,
      ),
    layout: {
      sections: definition.layout.sections.map((section) => ({
        ...section,
        rows: section.rows.filter(
          (row) => !row.cols.some((col) => col.fieldKey === "note"),
        ),
      })),
    },
  };
};

/** 升級過的提交:修訂 1 填在 v1、修訂 2 是升級到 v2 的那一筆。 */
const upgradedWorld = () => ({
  moduleForms: [shoppingForm],
  versions: {
    [`${SHOPPING_FORM_KEY}@1`]: versionOne(),
    [`${SHOPPING_FORM_KEY}@2`]: versionTwo(),
  },
  submissions: [
    submissionFragment({
      version: 2,
      viewedVersion: 2,
      revision: 2,
      viewedRevision: 2,
      values: { item: "雞蛋", qty: "2", unit_price: "30", total: "60" },
      revisions: [
        {
          revision: 1,
          version: 1,
          at: EARLY,
          user: { id: "user-1", name: "小華" },
        },
        {
          revision: 2,
          version: 2,
          kind: "upgrade",
          // ctx 沿用上一筆(填寫者小華);升級的人與時間另記
          at: EARLY,
          user: { id: "user-1", name: "小華" },
          upgradedBy: { id: "user-2", name: "阿明" },
          upgradedAt: "2026-03-01T04:00:00.000Z",
        },
      ],
    }),
  ],
  snapshots: {
    "sub-1": {
      1: {
        item: "雞蛋",
        qty: "2",
        unit_price: "30",
        total: "60",
        note: "要放山",
      },
      2: { item: "雞蛋", qty: "2", unit_price: "30", total: "60" },
    },
  },
});

const openHistory = async (user: ReturnType<typeof renderShopping>["user"]) => {
  await screen.findByRole("heading", { name: "檢視・雞蛋" });
  await user.click(screen.getByRole("button", { name: "修訂紀錄" }));
  const dialog = await screen.findByRole("dialog", { name: "修訂紀錄" });
  return within(dialog).findByRole("region", { name: "修訂紀錄" });
};

describe("修訂紀錄用各修訂自己的版本渲染(舊版資料升級後)", () => {
  it("升級產生的修訂印升級者與升級時間、升級到第幾版", async () => {
    const { user } = renderShopping({
      path: `${DEMO_FORM_ROUTES.viewPage}/sub-1`,
      world: upgradedWorld(),
    });

    const history = await openHistory(user);

    expect(
      within(history).getByText(
        "修訂 2 · 阿明 於 2026-03-01 12:00 升級到第 2 版",
      ),
    ).toBeInTheDocument();
  });

  it("檢視修訂 1 用 v1 的定義渲染", async () => {
    const { user } = renderShopping({
      path: `${DEMO_FORM_ROUTES.viewPage}/sub-1`,
      world: upgradedWorld(),
    });
    expect(
      await screen.findByRole("textbox", { name: "品名" }),
    ).toBeInTheDocument();
    const history = await openHistory(user);

    await user.click(
      within(history).getByRole("button", { name: "檢視修訂 1" }),
    );

    expect(await screen.findByText("正在檢視修訂 1")).toBeInTheDocument();
    expect(
      await screen.findByRole("textbox", { name: "品項(舊)" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "品名" })).toBeNull();
  });

  it("差異:升級丟掉的欄位(只在前一修訂的版本有)也列出", async () => {
    const { user } = renderShopping({
      path: `${DEMO_FORM_ROUTES.viewPage}/sub-1`,
      world: upgradedWorld(),
    });
    const history = await openHistory(user);

    await user.click(
      within(history).getByRole("button", { name: "與前一修訂的差異" }),
    );

    const diff = await within(history).findByRole("table", {
      name: "修訂 2 的差異",
    });
    expect(within(diff).getByText("備註")).toBeInTheDocument();
    expect(within(diff).getByText("要放山")).toBeInTheDocument();
  });
});
