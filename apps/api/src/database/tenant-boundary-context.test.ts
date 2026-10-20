import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import { TENANT_BOUNDARY_CONTEXT_CALLERS } from "./tenant-boundary-context";

const SRC_ROOT = path.resolve(__dirname, "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      return entry === "test-support" ? [] : sourceFiles(full);
    }
    return entry.endsWith(".ts") && !entry.endsWith(".test.ts") ? [full] : [];
  });
}

/** 呼叫某個函式(`名稱(`)的正式程式碼檔(相對 src、排序;註解裡提到名稱不算呼叫)。 */
function filesCalling(name: string): string[] {
  const pattern = new RegExp(String.raw`(?<![\w.])${name}\(`);
  return sourceFiles(SRC_ROOT)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC_ROOT, file).split(path.sep).join("/"))
    .toSorted((left, right) => left.localeCompare(right));
}

/**
 * 租戶邊界上下文(ADR-0005「例外出口」)的呼叫端登記:每個檔附用途(反查 / 以人為準的資料 / 例外寫入 / 排程)。
 * 底層的 `systemTenantReader` 只准經 `tenantBoundaryContext` 呼叫。
 */
describe("租戶邊界上下文的呼叫端登記", () => {
  it("呼叫 tenantBoundaryContext 的檔案都在登記清單內(定義它的檔除外)", () => {
    expect(
      filesCalling("tenantBoundaryContext").filter(
        (file) => file !== "database/tenant-boundary-context.ts",
      ),
    ).toEqual(
      Object.keys(TENANT_BOUNDARY_CONTEXT_CALLERS).toSorted((left, right) =>
        left.localeCompare(right),
      ),
    );
  });

  it("每一筆都有用途", () => {
    for (const purposes of Object.values(TENANT_BOUNDARY_CONTEXT_CALLERS)) {
      expect(purposes.length).toBeGreaterThan(0);
    }
  });

  it("systemTenantReader 只經 tenantBoundaryContext 呼叫", () => {
    expect(
      filesCalling("systemTenantReader").filter(
        (file) => file !== "database/system-tenant-reader.ts",
      ),
    ).toEqual(["database/tenant-boundary-context.ts"]);
  });
});
