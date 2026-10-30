import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import { WORKFLOW_SUBMISSION_STORE_CALLERS } from "./workflow-submission-store";

const SRC_ROOT = path.resolve(__dirname, "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return entry.endsWith(".ts") && !entry.endsWith(".test.ts") ? [full] : [];
  });
}

/**
 * `WorkflowSubmissionStore` 是 ADR-0005 登記的例外出口(不套可見範圍與資料範圍規則、以 `tenantId` 為邊界):
 * 只有登記在 `WORKFLOW_SUBMISSION_STORE_CALLERS` 的檔案可以引用,不只靠檔頭的 eslint 豁免。
 */
describe("WorkflowSubmissionStore 的呼叫端登記", () => {
  it("正式程式碼裡引用它的檔案都在登記清單內", () => {
    const callers = sourceFiles(SRC_ROOT)
      .filter((file) => !file.endsWith("workflow-submission-store.ts"))
      .filter((file) =>
        readFileSync(file, "utf8").includes("workflow-submission-store"),
      )
      .map((file) => path.relative(SRC_ROOT, file).split(path.sep).join("/"))
      .toSorted((left, right) => left.localeCompare(right, "zh-Hant"));
    expect(callers).toEqual(
      [...WORKFLOW_SUBMISSION_STORE_CALLERS].toSorted((left, right) =>
        left.localeCompare(right, "zh-Hant"),
      ),
    );
  });
});
