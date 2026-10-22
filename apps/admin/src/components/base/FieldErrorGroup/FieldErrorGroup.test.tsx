import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";

import { AppThemeProvider } from "@repo/ui/app-theme-provider";
import { defaultBrand } from "@repo/ui/theme";

import { useFieldErrorText } from "../FieldErrorText/useFieldErrorText";
import { FieldErrorGroup } from "./FieldErrorGroup";

const RadioWithError = ({ text }: { text: string | undefined }) => {
  const { describedBy, errorText } = useFieldErrorText(text);
  return (
    <>
      <div role="radiogroup" aria-label="種類" aria-describedby={describedBy}>
        <input type="radio" aria-label="整天" />
      </div>
      {errorText}
    </>
  );
};

/** REACT-18:群組欄位的原因畫在群組下方,並以 aria-describedby 連到群組(報讀軟體讀得到)。 */
describe("群組欄位的錯誤原因", () => {
  it("FieldErrorGroup:有原因 → 群組的無障礙描述就是原因;沒有 → 不畫、不連", () => {
    const { rerender } = render(
      <AppThemeProvider brand={defaultBrand}>
        <FieldErrorGroup label="執行任務" errorText="每一列都要選任務">
          <input type="checkbox" aria-label="負責" />
        </FieldErrorGroup>
      </AppThemeProvider>,
    );
    expect(
      screen.getByRole("group", { name: "執行任務" }),
    ).toHaveAccessibleDescription("每一列都要選任務");

    rerender(
      <AppThemeProvider brand={defaultBrand}>
        <FieldErrorGroup label="執行任務" errorText={undefined}>
          <input type="checkbox" aria-label="負責" />
        </FieldErrorGroup>
      </AppThemeProvider>,
    );
    expect(screen.getByRole("group", { name: "執行任務" })).not.toHaveAttribute(
      "aria-describedby",
    );
    expect(screen.queryByText("每一列都要選任務")).not.toBeInTheDocument();
  });

  it("useFieldErrorText:describedBy 放在自己的群組上(單選群組、開關)", () => {
    render(
      <AppThemeProvider brand={defaultBrand}>
        <RadioWithError text="這一天已經有整天的畫休" />
      </AppThemeProvider>,
    );
    expect(
      screen.getByRole("radiogroup", { name: "種類" }),
    ).toHaveAccessibleDescription("這一天已經有整天的畫休");
  });
});
