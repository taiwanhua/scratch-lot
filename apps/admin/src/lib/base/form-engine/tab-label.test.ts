import { describe, expect, it } from "@jest/globals";

import type { FormDefinition } from "@repo/domain/form";

import {
  type TabLabelContext,
  applyTabLabelTemplate,
  renderTabLabel,
  summaryDateTypeOf,
  tabLabelTemplateOf,
} from "./tab-label";

const fields = [
  { key: "reason", label: "事由", type: "text" },
  {
    key: "kind",
    label: "假別",
    type: "select",
    options: {
      kind: "static",
      items: [{ value: "sick", label: "病假", order: 0, enabled: true }],
    },
  },
  { key: "day", label: "日期", type: "date" },
  { key: "hours", label: "時數", type: "number", precision: 1 },
] as unknown as FormDefinition["fields"];

const definition = {
  fields,
  summaryMap: { title: "kind", date: "day", amount: "hours" },
};

/** 一筆草稿(還沒送出)的值:台北 09-26 = `2026-09-25T16:00:00.000Z` */
const context: TabLabelContext = {
  values: {
    reason: "感冒",
    kind: "sick",
    day: "2026-09-25T16:00:00.000Z",
    hours: "8",
  },
  definition,
  formName: "病假單",
  moduleName: "示範表單(群組內)",
  applicantName: "王小明",
  action: "檢視",
  joinAction: (action, label) => `${action}・${label}`,
  timezone: "Asia/Taipei",
};

describe("頁籤 / 標題模板(前端即時算)", () => {
  it("摘要槽依那一版 summaryMap 從值取:{{title}} 印選項 label、{{date}} 依時區、{{amount}} 照 precision", () => {
    expect(
      renderTabLabel("{{title}} {{date}} {{amount}}", {
        ...context,
        action: "",
      }),
    ).toBe("病假 2026-09-26 8.0");
  });

  it("{{value.<key>}} 直接取欄位值;不存在的欄位換空字串", () => {
    expect(
      renderTabLabel("{{value.reason}}{{value.nope}}", {
        ...context,
        action: "",
      }),
    ).toBe("感冒");
  });

  it("系統佔位符 {{applicant}} / {{form}} / {{module}}", () => {
    expect(
      renderTabLabel("{{module}}:{{applicant}}的{{form}}", {
        ...context,
        action: "",
      }),
    ).toBe("示範表單(群組內):王小明的病假單");
  });

  it("{{action}} 沒寫 → 自動加在最前面、以「・」分隔;有寫就照模板位置", () => {
    expect(renderTabLabel("{{applicant}}的{{title}}單", context)).toBe(
      "檢視・王小明的病假單",
    );
    expect(renderTabLabel("{{title}}({{action}})", context)).toBe("病假(檢視)");
  });

  it("草稿沒對日期欄時 {{date}} 空白(沒有送出時間);有送出時間印到分鐘", () => {
    const unmapped = { ...definition, summaryMap: { title: "kind" } };
    expect(
      renderTabLabel("{{date}}", {
        ...context,
        definition: unmapped,
        action: "",
      }),
    ).toBe("病假單");
    expect(
      renderTabLabel("{{date}}", {
        ...context,
        definition: unmapped,
        action: "",
        submittedAt: "2026-09-26T06:30:00.000Z",
      }),
    ).toBe("2026-09-26 14:30");
  });

  it("套出來是空的退回表單名(仍加頁面種類);都沒有回 null", () => {
    expect(renderTabLabel("{{value.nope}}", context)).toBe("檢視・病假單");
    expect(
      applyTabLabelTemplate("{{title}}", () => null, {
        action: "新增",
        joinAction: context.joinAction,
      }),
    ).toBeNull();
  });

  it("表單沒設模板(null / 空白)就用模組層的", () => {
    expect(tabLabelTemplateOf("{{title}}", null)).toBe("{{title}}");
    expect(tabLabelTemplateOf("{{title}}", "  ")).toBe("{{title}}");
    expect(tabLabelTemplateOf("{{title}}", "{{form}}")).toBe("{{form}}");
  });

  it("summaryDateTypeOf:對到日期欄 → date,其餘(日期時間欄、沒對、沒載到)→ datetime", () => {
    expect(summaryDateTypeOf(definition)).toBe("date");
    expect(summaryDateTypeOf({ fields, summaryMap: {} })).toBe("datetime");
    expect(summaryDateTypeOf(null)).toBe("datetime");
  });
});
