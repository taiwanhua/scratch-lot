import { describe, expect, it } from "@jest/globals";

import { field } from "@/test/msw/form-fixtures";

import { type ListRowLike, listTemplateTextOf } from "./list-columns";

const FIELDS = [
  field("start_at", "開始", "datetime"),
  field("end_at", "結束", "datetime"),
  field("day", "日期", "date"),
  field("note", "備註", "text"),
];

const row = (values: Record<string, unknown>): ListRowLike => ({
  formKey: "shift",
  version: 1,
  values,
  serialNo: null,
  summary: { title: null, date: "2026-10-28T16:00:00.000Z", amount: null },
});

const textOf = (template: string, values: Record<string, unknown>) =>
  listTemplateTextOf(template, row(values), FIELDS, {
    displayOf: () => [],
    text: { yes: "是", no: "否", unavailable: "(來源不可用)" },
    timezone: "Asia/Taipei",
    slotText: (_slot, value) => `<${value}>`,
  });

describe("組合欄:日期佔位符的格式字串", () => {
  const values = {
    start_at: "2026-10-29T01:00:00.000Z",
    end_at: "2026-10-29T09:00:00.000Z",
    day: "2026-10-28T16:00:00.000Z",
    note: "早班",
  };

  it("依讀者時區照格式印(token 同 dayjs);沒加格式照一般顯示", () => {
    expect(
      textOf("{{value.start_at|HH:mm}}–{{value.end_at|HH:mm}}", values),
    ).toBe("09:00–17:00");
    expect(textOf("{{value.day|YYYY/MM/DD}}", values)).toBe("2026/10/29");
    expect(textOf("{{value.start_at|M月D日 h:mm A}}", values)).toBe(
      "10月29日 9:00 AM",
    );
    expect(textOf("{{value.start_at}}", values)).toBe("2026-10-29 09:00");
  });

  it("「日期」槽也可加格式;沒加格式走 slotText", () => {
    expect(textOf("{{date|MM-DD}}", values)).toBe("10-29");
    expect(textOf("{{date}}", values)).toBe("<2026-10-28T16:00:00.000Z>");
  });

  it("沒值、讀不到(遮蔽)→ 空白;改版後不是日期的欄位 → 不套格式、照一般顯示", () => {
    expect(
      textOf("[{{value.start_at|HH:mm}}]", { ...values, start_at: null }),
    ).toBe("[]");
    expect(
      textOf("[{{value.start_at|HH:mm}}]", {
        ...values,
        start_at: "[redacted]",
      }),
    ).toBe("[]");
    expect(textOf("{{value.note|HH:mm}}", values)).toBe("早班");
  });
});
