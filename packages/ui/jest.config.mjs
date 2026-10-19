/**
 * `packages/ui` 的 jest 設定(從 package.json 的 `jest` 欄搬出來,才放得下註解)。
 *
 * - preset 用 `browser-esm`(不是 `browser`):`react-markdown` / `remark-gfm` 只出 ESM,
 *   CJS 模式的 ts-jest 一 require 就是 `Unexpected token 'export'`。執行時需
 *   `node --experimental-vm-modules`(見 package.json 的 test script)。
 * - `testEnvironment` 覆寫回原生 `jsdom`:preset 為了 MSW 用的 `jest-fixed-jsdom` 會把
 *   `Blob` / `File` 換成 Node 的實作,jsdom 的 `URL.createObjectURL` 就收不下 `File`
 *   (`UploadField` 的四個測試會炸)。ui 不用 MSW,不需要那層修補。
 */
/** @type {import('jest').Config} */
const config = {
  preset: "@repo/jest-presets/browser-esm",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
};

export default config;
