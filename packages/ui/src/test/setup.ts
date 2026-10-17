import "@testing-library/jest-dom/jest-globals";

import { CompressionStream } from "node:stream/web";
import { TextEncoder } from "node:util";

import { afterEach } from "@jest/globals";
import { cleanup } from "@testing-library/react";

// jsdom 環境沒有這兩個瀏覽器內建 API(瀏覽器都有):QR code 套件要 TextEncoder,
// 58mm 單據轉 PNG 要 CompressionStream。從 Node 的同名實作補上,不改元件程式。
for (const [name, value] of Object.entries({
  TextEncoder,
  CompressionStream,
})) {
  if (!(name in globalThis)) Object.assign(globalThis, { [name]: value });
}

// 元件測試共用的收尾:每個案例後拆掉掛載的 DOM(portal 的 Dialog / Popover 也一併清掉)
afterEach(() => {
  cleanup();
});
