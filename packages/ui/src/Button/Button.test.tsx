import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { createRoot } from "react-dom/client";

import { AppThemeProvider } from "../AppThemeProvider/AppThemeProvider";
import { defaultBrand } from "../theme/brands/default";
import { Button } from "./Button";

const styleOf = (name: string) =>
  globalThis.getComputedStyle(screen.getByRole("button", { name }));

describe("Button", () => {
  it("renders without crashing", () => {
    expect(() => {
      const div = document.createElement("div");
      const root = createRoot(div);
      root.render(<Button>儲存</Button>);
      root.unmount();
    }).not.toThrow();
  });

  /**
   * MUI 預設 `line-height: 1.75`,行框高出字框的部分依字型的 ascent / descent 分配,
   * 中文標籤因此偏離按鈕中線(填色按鈕看得最明顯)。`line-height: 1` + 固定高度讓上下對稱。
   */
  it("文字用固定高度 + line-height 1 垂直置中,尺寸對齊 Figma 的 32 / 36 / 48", () => {
    render(
      <AppThemeProvider brand={defaultBrand}>
        <Button size="small">開通租戶</Button>
        <Button size="medium">新增使用者</Button>
        <Button size="large">送出</Button>
      </AppThemeProvider>,
    );

    expect(styleOf("開通租戶").height).toBe("32px");
    expect(styleOf("新增使用者").height).toBe("36px");
    expect(styleOf("送出").height).toBe("48px");
    expect(styleOf("開通租戶").lineHeight).toBe("1");
  });
});
