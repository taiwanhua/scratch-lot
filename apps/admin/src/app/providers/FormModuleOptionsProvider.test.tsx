import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

import { useFormModuleOptions } from "@/hooks/base/useFormModuleOptions";
import { composeFormModuleOptions } from "@/lib/base/form-engine/form-module-options";
import { DEFAULT_TAB_LABEL_TEMPLATE } from "@/lib/base/form-engine/tab-label";

import { FormModuleOptionsProvider } from "./FormModuleOptionsProvider";

interface TemplateProbeProps {
  moduleKey: string;
  label: string;
}

/** 把 hook 讀到的模組層模板印出來。 */
const TemplateProbe = ({ moduleKey, label }: TemplateProbeProps) => (
  <output aria-label={label}>
    {useFormModuleOptions(moduleKey).tabLabelTemplate}
  </output>
);

describe("FormModuleOptionsProvider:由 Provider 注入,沒有全域登記", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("同一個程序裡兩份組裝各讀各的,互不污染", () => {
    const first = composeFormModuleOptions([
      { moduleKey: "leave", options: { tabLabelTemplate: "{{applicant}}" } },
    ]);
    const second = composeFormModuleOptions([
      { moduleKey: "leave", options: { tabLabelTemplate: "{{form}}" } },
      { moduleKey: "trip", options: { tabLabelTemplate: "{{amount}}" } },
    ]);

    render(
      <>
        <FormModuleOptionsProvider options={first}>
          <TemplateProbe moduleKey="leave" label="第一份的請假" />
          <TemplateProbe moduleKey="trip" label="第一份的出差" />
        </FormModuleOptionsProvider>
        <FormModuleOptionsProvider options={second}>
          <TemplateProbe moduleKey="leave" label="第二份的請假" />
          <TemplateProbe moduleKey="trip" label="第二份的出差" />
        </FormModuleOptionsProvider>
      </>,
    );

    expect(screen.getByLabelText("第一份的請假")).toHaveTextContent(
      "{{applicant}}",
    );
    // 第二份登記了出差,第一份沒有 → 第一份讀到的是預設,不是第二份的值
    expect(screen.getByLabelText("第一份的出差")).toHaveTextContent(
      DEFAULT_TAB_LABEL_TEMPLATE,
    );
    expect(screen.getByLabelText("第二份的請假")).toHaveTextContent("{{form}}");
    expect(screen.getByLabelText("第二份的出差")).toHaveTextContent(
      "{{amount}}",
    );
  });

  it("有 Provider 但沒登記該模組:回預設值", () => {
    render(
      <FormModuleOptionsProvider options={composeFormModuleOptions([])}>
        <TemplateProbe moduleKey="custom-page" label="沒登記的模組" />
      </FormModuleOptionsProvider>,
    );

    expect(screen.getByLabelText("沒登記的模組")).toHaveTextContent(
      DEFAULT_TAB_LABEL_TEMPLATE,
    );
  });

  it("沒有 Provider 是接線錯誤:直接丟出來,不默默退回預設", () => {
    // React 會把 render 期間的錯誤再印一次到 console.error;這個案子的錯誤是預期的
    jest.spyOn(console, "error").mockImplementation(() => {
      // 靜音
    });

    expect(() =>
      render(<TemplateProbe moduleKey="leave" label="沒接線" />),
    ).toThrow("useFormModuleOptions must be used within");
  });
});
