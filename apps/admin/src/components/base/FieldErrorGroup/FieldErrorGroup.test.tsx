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
      <div role="radiogroup" aria-label="類型" aria-describedby={describedBy}>
        <input type="radio" aria-label="甲" />
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
        <FieldErrorGroup label="通知對象" errorText="至少要選一位">
          <input type="checkbox" aria-label="張三" />
        </FieldErrorGroup>
      </AppThemeProvider>,
    );
    expect(
      screen.getByRole("group", { name: "通知對象" }),
    ).toHaveAccessibleDescription("至少要選一位");

    rerender(
      <AppThemeProvider brand={defaultBrand}>
        <FieldErrorGroup label="通知對象" errorText={undefined}>
          <input type="checkbox" aria-label="張三" />
        </FieldErrorGroup>
      </AppThemeProvider>,
    );
    expect(screen.getByRole("group", { name: "通知對象" })).not.toHaveAttribute(
      "aria-describedby",
    );
    expect(screen.queryByText("至少要選一位")).not.toBeInTheDocument();
  });

  it("useFieldErrorText:describedBy 放在自己的群組上(單選群組、開關)", () => {
    render(
      <AppThemeProvider brand={defaultBrand}>
        <RadioWithError text="這個名稱已被使用" />
      </AppThemeProvider>,
    );
    expect(
      screen.getByRole("radiogroup", { name: "類型" }),
    ).toHaveAccessibleDescription("這個名稱已被使用");
  });
});
