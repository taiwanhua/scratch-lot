import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

/**
 * 依 **import 來源**找檔案:任何 `import … from` / `export … from` / `import(…)` / `require(…)`
 * 的模組路徑最後一段是 `<moduleName>`(可帶 `.js` / `.ts`)就算。`* as ns`、改名、重新匯出都抓得到,
 * 註解裡提到名稱不算。
 */
function filesImporting(root: string, moduleName: string): string[] {
  const pattern = new RegExp(
    String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'][^"']*/${moduleName}(?:\.js|\.ts)?["']`,
  );
  return sourceFiles(root)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .toSorted((left, right) => left.localeCompare(right));
}

const byPath = (left: string, right: string): number =>
  left.localeCompare(right);

/**
 * 租戶邊界上下文(ADR-0005「例外出口」)的呼叫端登記:每個檔附用途(反查 / 以人為準的資料 / 例外寫入 /
 * 排程 / 系統重算)。底層的 `systemTenantReader` 只准由 `tenant-boundary-context.ts` 引用。
 */
describe("租戶邊界上下文的呼叫端登記(依 import 來源)", () => {
  it("import tenant-boundary-context 的檔案都在登記清單內", () => {
    expect(filesImporting(SRC_ROOT, "tenant-boundary-context")).toEqual(
      Object.keys(TENANT_BOUNDARY_CONTEXT_CALLERS).toSorted(byPath),
    );
  });

  it("每一筆都有用途", () => {
    for (const purposes of Object.values(TENANT_BOUNDARY_CONTEXT_CALLERS)) {
      expect(purposes.length).toBeGreaterThan(0);
    }
  });

  it("import system-tenant-reader 的只有 tenant-boundary-context.ts", () => {
    expect(filesImporting(SRC_ROOT, "system-tenant-reader")).toEqual([
      "database/tenant-boundary-context.ts",
    ]);
  });

  it("`import * as ns`、改名、重新匯出、動態 import 都抓得到;註解裡提到不算(暫存目錄)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "boundary-scan-"));
    try {
      const write = (relative: string, content: string): void => {
        mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
        writeFileSync(path.join(root, relative), content);
      };
      write(
        "a/namespace.ts",
        'import * as ns from "../database/system-tenant-reader";\nvoid ns;\n',
      );
      write(
        "b/renamed.ts",
        'import { systemTenantReader as reader } from "../../database/system-tenant-reader.js";\nvoid reader;\n',
      );
      write(
        "c/reexport.ts",
        'export { systemTenantReader } from "../database/system-tenant-reader";\n',
      );
      write(
        "d/dynamic.ts",
        'export const load = () => import("../database/system-tenant-reader");\n',
      );
      write(
        "e/comment-only.ts",
        "// 這裡只是提到 system-tenant-reader,沒有 import\nexport const x = 1;\n",
      );
      expect(filesImporting(root, "system-tenant-reader")).toEqual([
        "a/namespace.ts",
        "b/renamed.ts",
        "c/reexport.ts",
        "d/dynamic.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
