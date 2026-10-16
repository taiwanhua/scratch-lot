import { describe, expect, it } from "@jest/globals";

import {
  DEFAULT_FORM_MODULE_OPTIONS,
  type FormModuleOptionsEntry,
  composeFormModuleOptions,
  formModuleOptionsOf,
} from "./form-module-options";
import { DEFAULT_TAB_LABEL_TEMPLATE } from "./tab-label";

describe("composeFormModuleOptions(表單模組設定的純合成)", () => {
  it("每個模組一筆;沒給模板的沿用預設模板", () => {
    const registry = composeFormModuleOptions([
      { moduleKey: "demo-form" },
      { moduleKey: "leave", options: { tabLabelTemplate: "{{applicant}}" } },
      { moduleKey: "trip", options: {} },
    ]);

    expect([...registry.keys()]).toEqual(["demo-form", "leave", "trip"]);
    expect(registry.get("demo-form")).toEqual({
      tabLabelTemplate: DEFAULT_TAB_LABEL_TEMPLATE,
    });
    expect(registry.get("leave")).toEqual({
      tabLabelTemplate: "{{applicant}}",
    });
    expect(registry.get("trip")).toEqual(DEFAULT_FORM_MODULE_OPTIONS);
  });

  it("同一個模組 key 登記兩次就拒絕,錯誤列出 key", () => {
    expect(() =>
      composeFormModuleOptions([
        { moduleKey: "leave" },
        { moduleKey: "trip" },
        { moduleKey: "leave", options: { tabLabelTemplate: "{{form}}" } },
      ]),
    ).toThrow(/leave/);
  });

  it("空的模組 key 拒絕", () => {
    expect(() => composeFormModuleOptions([{ moduleKey: "" }])).toThrow(
      /模組 key/,
    );
  });

  it("不修改輸入,兩次合成各自獨立(沒有共用的可變狀態)", () => {
    const options = Object.freeze({ tabLabelTemplate: "{{amount}}" });
    const entries: readonly FormModuleOptionsEntry[] = Object.freeze([
      Object.freeze({ moduleKey: "leave", options }),
    ]);

    const first = composeFormModuleOptions(entries);
    const second = composeFormModuleOptions([{ moduleKey: "trip" }]);

    expect(entries).toEqual([{ moduleKey: "leave", options }]);
    expect(first.has("trip")).toBe(false);
    expect(second.has("leave")).toBe(false);
    expect(first.get("leave")).not.toBe(options);
  });
});

describe("formModuleOptionsOf(查一個模組的設定)", () => {
  it("有登記回登記值;沒登記回預設", () => {
    const registry = composeFormModuleOptions([
      { moduleKey: "leave", options: { tabLabelTemplate: "{{applicant}}" } },
    ]);

    expect(formModuleOptionsOf(registry, "leave").tabLabelTemplate).toBe(
      "{{applicant}}",
    );
    expect(formModuleOptionsOf(registry, "trip")).toEqual(
      DEFAULT_FORM_MODULE_OPTIONS,
    );
  });
});
