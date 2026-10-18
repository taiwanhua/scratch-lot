import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";

import { PRINTER_TEST_BARCODE, PrinterTestPage } from "./PrinterTestPage";
import { printerTestPageLabels } from "./printer-test-page-fixture";

const renderTestPage = () =>
  render(
    <PrinterTestPage
      tenantName="示範商店"
      printerName="櫃台收據機"
      printerHost="192.0.2.50"
      time="2026-10-15 10:30"
      managementUrl="https://admin.example.test/system/printers"
      labels={printerTestPageLabels}
    />,
  );

describe("PrinterTestPage", () => {
  it("表頭:最上層組織名稱、「測試頁」、印表機名稱與 IP、時間", () => {
    renderTestPage();

    expect(screen.getByText("示範商店")).toBeInTheDocument();
    expect(screen.getByText("測試頁")).toBeInTheDocument();
    expect(screen.getByText("櫃台收據機 · 192.0.2.50")).toBeInTheDocument();
    expect(screen.getByText("2026-10-15 10:30")).toBeInTheDocument();
  });

  it("字體大小:大字、一般字、小字、粗體字各一行", () => {
    renderTestPage();

    for (const [text, variant] of [
      ["大字 ABC 123", "large"],
      ["一般字 ABC 123", "normal"],
      ["小字 ABC 123", "small"],
      ["粗體字 ABC 123", "bold"],
    ] as const) {
      expect(screen.getByText(text).dataset.receipt58Text).toBe(variant);
    }
  });

  it("對齊:靠左、置中、靠右各一行", () => {
    renderTestPage();

    expect(getComputedStyle(screen.getByText("靠左")).textAlign).toBe("left");
    expect(getComputedStyle(screen.getByText("置中")).textAlign).toBe("center");
    expect(getComputedStyle(screen.getByText("靠右")).textAlign).toBe("right");
  });

  it("欄位:左右兩欄、三欄表格(表頭 + 一列)", () => {
    renderTestPage();

    expect(screen.getByText("左欄")).toBeInTheDocument();
    expect(screen.getByText("右欄")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getAllByRole("cell")).toHaveLength(3);
  });

  it("換行:超過一行的長文字整段印出、可換行", () => {
    renderTestPage();

    const longText = screen.getByText(printerTestPageLabels.longText);
    expect(getComputedStyle(longText).whiteSpace).toBe("pre-wrap");
  });

  it("分隔線:各區塊之間的虛線", () => {
    const { container } = renderTestPage();

    // 表頭|字體大小|對齊|欄位|換行|條碼;條碼與切紙之間由切紙列的點線分隔
    expect(container.querySelectorAll("hr")).toHaveLength(5);
  });

  it("條碼:一維條碼(Code128)+ QR code(內容 = 印表機管理頁的連結)", () => {
    renderTestPage();

    expect(
      screen.getByRole("img", { name: PRINTER_TEST_BARCODE }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "https://admin.example.test/system/printers",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("掃描開啟印表機管理")).toBeInTheDocument();
  });

  it("切紙:最後一列是切紙位置", () => {
    const { container } = renderTestPage();

    const paper = container.firstElementChild;
    expect(paper?.lastElementChild).toHaveAttribute("data-receipt58-cut");
    expect(screen.getByText("切紙")).toBeInTheDocument();
  });

  it("各區塊依固定順序排列", () => {
    renderTestPage();

    const order = [
      "測試頁",
      "大字 ABC 123",
      "靠左",
      "左欄",
      "品項",
      printerTestPageLabels.longText,
      PRINTER_TEST_BARCODE,
      "掃描開啟印表機管理",
      "切紙",
    ].map((text) => screen.getAllByText(text)[0]);
    for (let index = 1; index < order.length; index += 1) {
      const previous = order[index - 1];
      const current = order[index];
      if (previous === undefined || current === undefined) {
        throw new Error("找不到區塊");
      }
      expect(
        previous.compareDocumentPosition(current) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});
