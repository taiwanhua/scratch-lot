import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { createRoot } from "react-dom/client";

import { AppThemeProvider } from "../AppThemeProvider/AppThemeProvider";
import { defaultBrand } from "../theme/brands/default";
import { Typography, type TypographyColor } from "./Typography";

const colorOf = (text: string) =>
  globalThis.getComputedStyle(screen.getByText(text)).color;

describe("Typography", () => {
  it("renders without crashing", () => {
    expect(() => {
      const div = document.createElement("div");
      const root = createRoot(div);
      root.render(<Typography variant="h4">標題</Typography>);
      root.unmount();
    }).not.toThrow();
  });

  it("color 的正式值套上 theme 對應的文字色與色票色", () => {
    render(
      <AppThemeProvider brand={defaultBrand}>
        <Typography color="textSecondary">次要</Typography>
        <Typography color="textDisabled">停用</Typography>
        <Typography color="warning">警告</Typography>
        <Typography color="error">錯誤</Typography>
      </AppThemeProvider>,
    );

    expect(colorOf("次要")).toContain("--mui-palette-text-secondary");
    expect(colorOf("停用")).toContain("--mui-palette-text-disabled");
    expect(colorOf("警告")).toContain("--mui-palette-warning-main");
    expect(colorOf("錯誤")).toContain("--mui-palette-error-main");
  });

  /** STYLE-12 的理由:帶點的 theme 路徑 MUI 不認,畫成一般字色;型別因此不收它。 */
  it("帶點的寫法不是正式值:型別擋下,硬塞也不會上色", () => {
    // @ts-expect-error 帶點的 theme 路徑不是 TypographyColor
    const dotted: TypographyColor = "text.secondary";

    render(
      <AppThemeProvider brand={defaultBrand}>
        <Typography color={dotted}>帶點</Typography>
      </AppThemeProvider>,
    );

    expect(colorOf("帶點")).not.toContain("--mui-palette-text-secondary");
  });
});
