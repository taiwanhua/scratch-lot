import { describe, expect, it, jest } from "@jest/globals";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";

import type { FormDefinition } from "@repo/domain/form";

import {
  DEMO_FORM_ROUTES,
  SHOPPING_FORM_KEY,
  field,
  submissionFragment,
} from "@/test/msw/form-fixtures";
import { api, server } from "@/test/msw/server";

import { renderShopping, shoppingForm } from "./form-module-test-support";

const VIEW_PATH = `${DEMO_FORM_ROUTES.viewPage}/sub-1`;

const staticItems = (...labels: [string, string][]) => ({
  kind: "static" as const,
  items: labels.map(([value, label], index) => ({
    value,
    label,
    order: index,
    enabled: true,
  })),
});

/** 每種型別 × 常見 widget 各一欄(唯讀檢視用)。 */
const everyType = (): FormDefinition => {
  const fields = [
    field("item", "品項", "text"),
    field("note", "備註", "multiline", { widget: { kind: "textArea" } }),
    field("price", "單價", "number", {
      widget: { kind: "number", unit: "元" },
    }),
    field("total", "總價", "number", {
      widget: { kind: "number", unit: "元" },
      valueSource: { kind: "computed", expr: { "*": [{ var: "price" }, 2] } },
    }),
    field("urgent", "急件", "boolean", { widget: { kind: "switch" } }),
    field("checked", "已確認", "boolean", { widget: { kind: "checkbox" } }),
    field("buy_on", "採購日", "date", { widget: { kind: "datePicker" } }),
    field("deliver_at", "送達時間", "datetime", {
      widget: { kind: "dateTimePicker" },
    }),
    field("kind", "分類", "select", {
      widget: { kind: "dropdown" },
      options: staticItems(["drink", "飲品"], ["food", "食品"]),
    }),
    field("pay", "付款", "select", {
      widget: { kind: "radio" },
      options: staticItems(["cash", "現金"], ["card", "刷卡"]),
    }),
    field("tags", "標籤", "multiSelect", {
      widget: { kind: "checkboxGroup" },
      options: staticItems(["organic", "有機"], ["cold", "冷藏"]),
    }),
    field("category", "類別", "select", {
      widget: { kind: "autocomplete" },
      options: { kind: "fieldCategory", key: "demo-category" },
    }),
    field("owner", "負責人", "reference", {
      widget: { kind: "referencePicker" },
      source: { provider: "user", labelField: "name" },
    }),
    field("receipt", "收據", "upload", { widget: { kind: "upload" } }),
    // 修訂時間(2026-01-05)早於 06-01:「晚到提醒」不顯示、「早鳥備註」顯示(讀者的現在已晚於它)
    field("late_note", "晚到提醒", "text", {
      visibleWhen: { ">": [{ now: [] }, "2026-06-01T00:00:00.000Z"] },
    }),
    field("early_note", "早鳥備註", "text", {
      visibleWhen: { "<": [{ now: [] }, "2026-06-01T00:00:00.000Z"] },
    }),
  ];
  return {
    fields,
    layout: {
      sections: [
        {
          key: "all",
          title: "全部欄位",
          rows: fields.map((item) => ({
            cols: [{ fieldKey: item.key, span: 12 }],
          })),
        },
      ],
    },
    summaryMap: { title: "item", date: null, amount: null },
    prefills: [],
  };
};

const renderEveryType = () =>
  renderShopping({
    path: VIEW_PATH,
    world: {
      moduleForms: [shoppingForm],
      versions: { [`${SHOPPING_FORM_KEY}@1`]: everyType() },
      submissions: [
        submissionFragment({
          values: {
            item: "牛奶",
            note: "早上送",
            price: "30",
            // 公式會算出 30 × 2 = 60;唯讀照存值顯示,不重算
            total: "99",
            urgent: true,
            checked: false,
            buy_on: "2026-09-25T16:00:00.000Z",
            deliver_at: "2026-03-01T01:30:00Z",
            kind: "drink",
            pay: "cash",
            tags: ["organic", "cold"],
            category: { value: "drink", label: "飲料(舊名)" },
            owner: { id: "user-9", label: "阿明(送出時)" },
            late_note: "晚點到",
            early_note: "早點到",
            receipt: {
              path: "forms/receipt.pdf",
              name: "receipt.pdf",
              size: 1024,
              contentType: "application/pdf",
            },
          },
          // 送出那次的租戶時區是紐約;讀者現在的租戶時區是台北(`me.currentOrg.timezone`)
          ctx: {
            at: "2026-01-05T02:00:00.000Z",
            timezone: "America/New_York",
            userId: "user-1",
            orgId: "org-1",
          },
          displayValues: [
            {
              fieldKey: "category",
              items: [{ value: "drink", label: "飲料", available: true }],
            },
            {
              fieldKey: "owner",
              items: [{ value: "user-9", label: "王阿明", available: true }],
            },
          ],
        }),
      ],
    },
  });

describe("表單模組詳情頁:唯讀 = 同一套填寫元件走 readOnly(不是停用)", () => {
  it("每種欄位型別都是可讀的唯讀欄位:不重算存值、選項顯示 label、日期以讀者租戶時區印、條件用修訂 ctx", async () => {
    renderEveryType();

    const item = await screen.findByRole("textbox", { name: "品項" });
    const expected: [string, string][] = [
      ["品項", "牛奶"],
      ["備註", "早上送"],
      ["單價", "30 元"],
      ["總價", "99 元"],
      ["採購日", "2026-09-26"],
      ["送達時間", "2026-03-01 09:30"],
      ["分類", "飲品"],
      ["付款", "現金"],
      ["標籤", "有機、冷藏"],
    ];
    // 日期以讀者的租戶時區(台北)印:紐約會是 2026-09-25 與 2026-02-28 20:30
    for (const [label, value] of expected) {
      const box = screen.getByRole("textbox", { name: label });
      expect(box).toHaveValue(value);
      expect(box).toHaveAttribute("readonly");
      expect(box).toBeEnabled();
    }
    expect(item).toBeEnabled();

    // 是否欄:同一個開關 / 勾選框,照一般外觀顯示開 / 關(不是停用)
    const urgent = screen.getByLabelText("急件");
    expect(urgent).toBeChecked();
    expect(urgent).toBeEnabled();
    const checked = screen.getByLabelText("已確認");
    expect(checked).not.toBeChecked();
    expect(checked).toBeEnabled();

    // 整頁沒有停用的輸入框(停用 = 灰字)
    expect(
      document.querySelectorAll("input:disabled, textarea:disabled"),
    ).toHaveLength(0);

    // 條件用該修訂的 ctx(ctx.now = 當時),不用讀者的現在
    expect(screen.queryByRole("textbox", { name: "晚到提醒" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "早鳥備註" })).toHaveValue(
      "早點到",
    );

    // 分區是有框的卡片 + 標題列
    const section = screen.getByRole("region", { name: "全部欄位" });
    expect(
      within(section).getByRole("heading", { name: "全部欄位" }),
    ).toBeInTheDocument();
    expect(section).toHaveClass("MuiCard-root");
  });

  it("類別選項與引用欄顯示現名(displayValues),不是送出時的快照 label", async () => {
    renderEveryType();

    expect(await screen.findByRole("textbox", { name: "類別" })).toHaveValue(
      "飲料",
    );
    expect(screen.getByRole("textbox", { name: "負責人" })).toHaveValue(
      "王阿明",
    );
  });

  it("附件可下載:點檔名去要簽名網址並開新分頁", async () => {
    const opened = jest
      .spyOn(globalThis, "open")
      .mockImplementation(() => null);
    const requested: unknown[] = [];
    server.use(
      api.query("FormSubmissionAttachmentUrl", ({ variables }) => {
        requested.push(variables);
        return HttpResponse.json({
          data: {
            formSubmissionAttachmentUrl: {
              url: "https://storage.test/receipt.pdf?sig=1",
            },
          },
        });
      }),
    );
    const { user } = renderEveryType();

    await user.click(
      await screen.findByRole("button", { name: "receipt.pdf" }),
    );

    await waitFor(() => {
      expect(opened).toHaveBeenCalledWith(
        "https://storage.test/receipt.pdf?sig=1",
        "_blank",
        "noopener",
      );
    });
    expect(requested).toEqual([
      expect.objectContaining({ id: "sub-1", fieldKey: "receipt" }),
    ]);
    opened.mockRestore();
  });
});
