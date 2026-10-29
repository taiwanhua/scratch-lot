import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { SCANNER_KEY_INTERVAL_MS } from "./scanner-detector";
import {
  type ScanEvent,
  injectScan,
  registerDefaultScanHandler,
} from "./scanner-registry";
import { useScanner } from "./useScanner";

const CODE = "0056527099";

let clock = 1_000_000;

/** 依指定間隔逐字按下(每個字元前先把時間往前推),最後按 Enter。 */
const typeKeys = (
  target: Element,
  text: string,
  intervalMs: number,
  onEachKey?: (typed: string) => void,
): void => {
  let typed = "";
  for (const key of text) {
    clock += intervalMs;
    const notCanceled = fireEvent.keyDown(target, { key });
    if (notCanceled) {
      typed += key;
      onEachKey?.(typed);
    }
  }
  clock += intervalMs;
  fireEvent.keyDown(target, { key: "Enter" });
};

interface ScannerPageProps {
  onScan: (event: ScanEvent) => void;
}

/** 宣告用途「測試」的頁面;放一個一般輸入框與一個條碼欄位。 */
const ScannerPage = ({ onScan }: ScannerPageProps) => {
  useScanner("test", onScan);
  const [plain, setPlain] = useState("");
  const [field, setField] = useState("");
  return (
    <>
      <input
        aria-label="一般輸入框"
        value={plain}
        onChange={(event) => {
          setPlain(event.target.value);
        }}
      />
      <input
        aria-label="條碼欄位"
        data-scanner-field
        value={field}
        onChange={(event) => {
          setField(event.target.value);
        }}
      />
    </>
  );
};

describe("useScanner(全域掃描監聽)", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockImplementation(() => clock);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it(`字元間隔 ${String(SCANNER_KEY_INTERVAL_MS)}ms + Enter → 觸發頁面的 handler`, () => {
    const onScan = jest.fn<(event: ScanEvent) => void>();
    render(<ScannerPage onScan={onScan} />);
    typeKeys(document.body, CODE, SCANNER_KEY_INTERVAL_MS);
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith({
      code: CODE,
      source: "keyboard",
      purpose: "test",
    });
  });

  it("人工慢打(間隔超過門檻)→ 不觸發", () => {
    const onScan = jest.fn<(event: ScanEvent) => void>();
    render(<ScannerPage onScan={onScan} />);
    typeKeys(document.body, CODE, 150);
    // 長度不夠也不算
    typeKeys(document.body, "12345", 10);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("游標在一般輸入框也攔截:讀到的碼交給 handler,輸入框回到原值", () => {
    const onScan = jest.fn<(event: ScanEvent) => void>();
    render(<ScannerPage onScan={onScan} />);
    const input = screen.getByRole("textbox", { name: "一般輸入框" });
    input.focus();
    // 模擬瀏覽器把按下的字元打進輸入框
    typeKeys(input, CODE, 10, (typed) => {
      fireEvent.change(input, { target: { value: typed } });
    });
    expect(onScan).toHaveBeenCalledWith(
      expect.objectContaining({ code: CODE }),
    );
    expect(input).toHaveValue("");
  });

  it("標記 data-scanner-field 的輸入框不攔,交給輸入框自己處理", () => {
    const onScan = jest.fn<(event: ScanEvent) => void>();
    render(<ScannerPage onScan={onScan} />);
    const field = screen.getByRole("textbox", { name: "條碼欄位" });
    field.focus();
    typeKeys(field, CODE, 10, (typed) => {
      fireEvent.change(field, { target: { value: typed } });
    });
    expect(onScan).not.toHaveBeenCalled();
    expect(field).toHaveValue(CODE);
  });

  it("頁面宣告優先於預設處理;頁面離開後交給預設處理", () => {
    const fallback = jest.fn<(event: ScanEvent) => void>();
    const unregister = registerDefaultScanHandler(fallback);
    try {
      const onScan = jest.fn<(event: ScanEvent) => void>();
      const { unmount } = render(<ScannerPage onScan={onScan} />);
      typeKeys(document.body, CODE, 10);
      expect(onScan).toHaveBeenCalledTimes(1);
      expect(fallback).not.toHaveBeenCalled();

      unmount();
      typeKeys(document.body, CODE, 10);
      expect(fallback).toHaveBeenCalledWith({
        code: CODE,
        source: "keyboard",
        purpose: null,
      });
    } finally {
      unregister();
    }
  });

  it("可注入模擬掃描事件(和條碼槍同一條分派);沒有任何處理者時回 false", () => {
    const onScan = jest.fn<(event: ScanEvent) => void>();
    const { unmount } = render(<ScannerPage onScan={onScan} />);
    expect(injectScan(CODE)).toBe(true);
    expect(onScan).toHaveBeenCalledWith({
      code: CODE,
      source: "injected",
      purpose: "test",
    });
    unmount();
    expect(injectScan(CODE)).toBe(false);
  });
});
