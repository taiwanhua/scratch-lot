import { describe, expect, it, jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";

import { Receipt58 } from "./Receipt58";
import { Receipt58Barcode } from "./Receipt58Barcode";
import { Receipt58Cut } from "./Receipt58Cut";
import { Receipt58Divider } from "./Receipt58Divider";
import { Receipt58Header } from "./Receipt58Header";
import { Receipt58Qr } from "./Receipt58Qr";
import { Receipt58Range } from "./Receipt58Range";
import { Receipt58ReprintMark } from "./Receipt58ReprintMark";
import { Receipt58Row } from "./Receipt58Row";
import { Receipt58Signature } from "./Receipt58Signature";
import { Receipt58Table } from "./Receipt58Table";
import { Receipt58Text, type Receipt58TextVariant } from "./Receipt58Text";
import { Receipt58Total } from "./Receipt58Total";
import { makeRgba } from "./png-test-support";
import {
  RECEIPT58_CJK_PER_LINE,
  RECEIPT58_CONTENT_WIDTH,
} from "./receipt58-tokens";
import { renderReceiptToPng } from "./render-receipt-to-png";

/** 17 個中文字:比一行(約 16 字)多一個。 */
const LONG_TEXT = "長文字換行這一行超過十六個中文字喔";

const reprint = {
  heading: "【補印】第 2 次",
  time: "2026-10-09 10:12",
  reason: "原因:破損",
  reprintedBy: "補印人:李大華",
};

const px = (value: string) => Number.parseFloat(value);

describe("Receipt58", () => {
  it("紙張固定寬 384 點、左右邊界 16,白底", () => {
    render(
      <Receipt58>
        <Receipt58Text>內容</Receipt58Text>
      </Receipt58>,
    );

    const paper = screen.getByText("內容").parentElement;
    if (paper === null) throw new Error("找不到紙張");
    const style = getComputedStyle(paper);
    expect(style.width).toBe("384px");
    expect(style.maxWidth).toBe("384px");
    expect(style.paddingLeft).toBe("16px");
    expect(style.paddingRight).toBe("16px");
  });

  it("預覽與列印用同一個元件:renderReceiptToPng 轉的就是預覽中的節點", async () => {
    const nodes: HTMLDivElement[] = [];
    render(
      <Receipt58
        ref={(node) => {
          if (node !== null) nodes.push(node);
        }}
      >
        <Receipt58Text>示範</Receipt58Text>
      </Receipt58>,
    );
    const preview = nodes[0];
    if (preview === undefined) throw new Error("沒有取到單據節點");
    const rasterized: HTMLElement[] = [];
    const rasterize = jest.fn((node: HTMLElement) => {
      rasterized.push(node);
      return Promise.resolve(makeRgba(384, 4, () => [0, 0, 0, 255]));
    });

    await renderReceiptToPng(preview, { rasterize });

    expect(rasterized).toHaveLength(1);
    expect(rasterized[0]).toBe(screen.getByText("示範").parentElement);
  });
});

describe("Receipt58Text", () => {
  it.each<Receipt58TextVariant>(["large", "normal", "small", "bold"])(
    "%s:長文字自動換行,不截斷、不省略",
    (variant) => {
      render(<Receipt58Text variant={variant}>{LONG_TEXT}</Receipt58Text>);

      const text = screen.getByText(LONG_TEXT);
      const style = getComputedStyle(text);
      expect(style.whiteSpace).toBe("pre-wrap");
      expect(style.overflowWrap).toBe("anywhere");
      expect(style.overflow).not.toBe("hidden");
      expect(style.textOverflow).not.toBe("ellipsis");
    },
  );

  it("一般字的字級讓一行約 16 個中文字:16 字恰好放滿可用寬,第 17 字換到下一行", () => {
    render(<Receipt58Text>{LONG_TEXT}</Receipt58Text>);

    const fontSize = px(getComputedStyle(screen.getByText(LONG_TEXT)).fontSize);
    expect(fontSize * RECEIPT58_CJK_PER_LINE).toBeLessThanOrEqual(
      RECEIPT58_CONTENT_WIDTH,
    );
    expect(fontSize * (RECEIPT58_CJK_PER_LINE + 1)).toBeGreaterThan(
      RECEIPT58_CONTENT_WIDTH,
    );
  });

  it("大 / 一般 / 小 字級遞減,粗體與一般同字級", () => {
    render(
      <>
        <Receipt58Text variant="large">大</Receipt58Text>
        <Receipt58Text variant="normal">一般</Receipt58Text>
        <Receipt58Text variant="small">小</Receipt58Text>
        <Receipt58Text variant="bold">粗</Receipt58Text>
      </>,
    );

    const size = (text: string) =>
      px(getComputedStyle(screen.getByText(text)).fontSize);
    expect(size("大")).toBeGreaterThan(size("一般"));
    expect(size("一般")).toBeGreaterThan(size("小"));
    expect(size("粗")).toBe(size("一般"));
    expect(getComputedStyle(screen.getByText("粗")).fontWeight).toBe("600");
  });

  it.each(["left", "center", "right"] as const)("對齊 %s", (align) => {
    render(<Receipt58Text align={align}>對齊</Receipt58Text>);

    expect(getComputedStyle(screen.getByText("對齊")).textAlign).toBe(align);
  });
});

describe("Receipt58Header", () => {
  it("印租戶名稱、單據名稱、單號與時間;沒有補印時不印補印標示", () => {
    const { container } = render(
      <Receipt58Header
        tenantName="示範商店"
        title="收據"
        documentNo="單號 C-0031"
        time="2026-10-13 15:02"
      />,
    );

    for (const text of [
      "示範商店",
      "收據",
      "單號 C-0031",
      "2026-10-13 15:02",
    ]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(
      container.querySelector("[data-receipt58-reprint]"),
    ).not.toBeInTheDocument();
  });

  it("補印時在單據名稱下方印補印標示", () => {
    render(
      <Receipt58Header tenantName="示範商店" title="收據" reprint={reprint} />,
    );

    expect(
      screen.getByText(
        "【補印】第 2 次 · 2026-10-09 10:12 · 原因:破損 · 補印人:李大華",
      ),
    ).toBeInTheDocument();
  });
});

describe("Receipt58ReprintMark", () => {
  it("依序印「【補印】第 N 次 · 時間 · 原因 · 補印人」", () => {
    render(<Receipt58ReprintMark {...reprint} reason="原因:收據被咖啡打濕" />);

    expect(
      screen.getByText(
        "【補印】第 2 次 · 2026-10-09 10:12 · 原因:收據被咖啡打濕 · 補印人:李大華",
      ),
    ).toBeInTheDocument();
  });
});

describe("Receipt58Row / Receipt58Total", () => {
  it("標籤與值各自成一段,值可換行", () => {
    render(
      <>
        <Receipt58Row label="分店" value={LONG_TEXT} />
        <Receipt58Total label="合計" value="3,400" />
      </>,
    );

    expect(screen.getByText("分店")).toBeInTheDocument();
    expect(getComputedStyle(screen.getByText(LONG_TEXT)).whiteSpace).toBe(
      "pre-wrap",
    );
    expect(getComputedStyle(screen.getByText("合計")).fontWeight).toBe("600");
    expect(screen.getByText("3,400")).toBeInTheDocument();
  });
});

describe("Receipt58Table", () => {
  it("表頭 + 內容列,最多 3 欄;第 2、3 欄靠右", () => {
    render(
      <Receipt58Table
        head={["品項", "數量", "金額"]}
        rows={[
          ["A 商品", "12", "2,400"],
          ["B 商品", "5", "1,000"],
        ]}
      />,
    );

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getAllByRole("columnheader")).toHaveLength(3);
    expect(getComputedStyle(screen.getByText("2,400")).textAlign).toBe("right");
  });

  it("可以只有 1 或 2 欄,沒有表頭", () => {
    render(<Receipt58Table rows={[["只有一欄"], ["兩欄", "值"]]} />);

    expect(screen.queryAllByRole("columnheader")).toHaveLength(0);
    expect(screen.getAllByRole("cell")).toHaveLength(3);
  });
});

describe("Receipt58Range", () => {
  it("印標籤、號碼區段與筆數", () => {
    render(
      <Receipt58Range
        label="序號:"
        numbers={[12, 13, 14, 15, 16, 20]}
        prefix="#"
        digits={3}
        formatCount={(count) => `(${String(count)} 筆)`}
      />,
    );

    expect(screen.getByText("序號:#012~016、#020(6 筆)")).toBeInTheDocument();
  });
});

describe("Receipt58Divider / Receipt58Signature / Receipt58Cut", () => {
  it("分隔線是虛線、簽名欄有角色與簽名線、切紙列有說明", () => {
    const { container } = render(
      <>
        <Receipt58Divider />
        <Receipt58Signature signer="經手人簽名" />
        <Receipt58Cut label="切紙" />
      </>,
    );

    const divider = container.querySelector("hr");
    if (divider === null) throw new Error("找不到分隔線");
    expect(getComputedStyle(divider).borderTopStyle).toBe("dashed");
    expect(screen.getByText("經手人簽名")).toBeInTheDocument();
    expect(
      container.querySelector("[data-receipt58-sign-line]"),
    ).toBeInTheDocument();
    expect(screen.getByText("切紙")).toBeInTheDocument();
  });
});

describe("Receipt58Qr / Receipt58Barcode", () => {
  it("QR code 以整數點模組畫在可用寬內,下方印說明", () => {
    render(
      <Receipt58Qr
        value="https://admin.example.test/doc/C-0031"
        caption="掃描開啟單據"
      />,
    );

    const qr = screen.getByRole("img", {
      name: "https://admin.example.test/doc/C-0031",
    });
    const side = Number(qr.getAttribute("width"));
    const modules = Number(qr.dataset.modules);
    expect(side).toBeLessThanOrEqual(RECEIPT58_CONTENT_WIDTH);
    expect(side % (modules + 8)).toBe(0);
    expect(screen.getByText("掃描開啟單據")).toBeInTheDocument();
  });

  it("一維條碼(Code128)寬度為模組數的整數倍、不超過可用寬,下方印內容", () => {
    render(<Receipt58Barcode value="D0031202610150001" />);

    const barcode = screen.getByRole("img", { name: "D0031202610150001" });
    const width = Number(barcode.getAttribute("width"));
    const modules = Number(barcode.dataset.modules);
    expect(width).toBeLessThanOrEqual(RECEIPT58_CONTENT_WIDTH);
    expect(width % modules).toBe(0);
    expect(screen.getByText("D0031202610150001")).toBeInTheDocument();
  });

  it("很長的條碼內容縮到 1 點模組,仍不超出可用寬", () => {
    const value = "X".repeat(40);
    render(<Receipt58Barcode value={value} />);

    const barcode = screen.getByRole("img", { name: value });
    expect(Number(barcode.getAttribute("width"))).toBe(
      Number(barcode.dataset.modules),
    );
  });
});
