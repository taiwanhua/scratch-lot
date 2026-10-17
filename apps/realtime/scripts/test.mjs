// CI 的 test-others 對所有套件統一傳 jest 參數(`turbo run test -- --forceExit`);vitest 不認得會直接報錯。
// 這裡濾掉 jest 專用參數,其餘原樣交給 `vitest run`。
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const JEST_ONLY_FLAGS = new Set([
  "--forceExit",
  "--detectOpenHandles",
  "--runInBand",
  "--passWithNoTests",
]);
const args = process.argv.slice(2).filter((arg) => !JEST_ONLY_FLAGS.has(arg));
const vitest = path.join(
  path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);
const child = spawn(process.execPath, [vitest, "run", ...args], {
  stdio: "inherit",
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
