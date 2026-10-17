import { config } from "@repo/eslint-config";

/**
 * `cloudflare:*` 是 Workers 執行環境內建的模組(型別由 `@cloudflare/workers-types` 與
 * `@cloudflare/vitest-plugin/types` 提供),檔案系統上找不到,告訴 import-x 視為內建模組。
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...config,
  {
    settings: {
      "import-x/core-modules": ["cloudflare:workers", "cloudflare:test"],
    },
  },
];
