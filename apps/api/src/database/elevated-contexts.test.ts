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

import { PROJECT_ELEVATED_CONTEXT_FILES } from "./database.module";
import { ELEVATED_CONTEXT_FILES } from "./elevated-contexts";

const SRC_ROOT = path.resolve(__dirname, "..");

/**
 * 提升上下文的寫法:把可見範圍或管理範圍寫成「全部」(prettier 統一成雙引號,冒號後的空白不固定)。
 * 以常數 / 變數間接賦值的寫法抓不到 —— 那種寫法 review 時直接退回。
 */
const ELEVATED_PATTERN = /(?:visibleOrgIds|managedOrgIds)\s*:\s*"all"/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      // 測試輔助只給測試用(夾具的系統上下文),不是正式程式碼
      return entry === "test-support" ? [] : sourceFiles(full);
    }
    return entry.endsWith(".ts") && !entry.endsWith(".test.ts") ? [full] : [];
  });
}

/** 正式程式碼裡出現提升上下文的檔案(相對 src、`/` 分隔、排序)。 */
function filesWithElevatedContext(root: string): string[] {
  return sourceFiles(root)
    .filter((file) => ELEVATED_PATTERN.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .toSorted((left, right) => left.localeCompare(right));
}

const byPath = (left: string, right: string): number =>
  left.localeCompare(right);

/**
 * 提升上下文(`visibleOrgIds: "all"`)只准出現在登記清單的檔案(ADR-0005「例外出口」、ADR-0014)。
 * 新增一處 = 這個測試紅,逼著先想能不能用登記過的出口,真的要加就連理由一起登記。
 */
describe("提升上下文的登記", () => {
  it('正式程式碼裡出現 visibleOrgIds: "all" 的檔案都在底座或專案的登記清單內', () => {
    const registered = [
      ...Object.keys(ELEVATED_CONTEXT_FILES),
      ...Object.keys(PROJECT_ELEVATED_CONTEXT_FILES),
    ].toSorted(byPath);
    expect(filesWithElevatedContext(SRC_ROOT)).toEqual(registered);
  });

  it("底座清單不登記 project/ 的檔案;專案清單只登記 project/ 的檔案", () => {
    expect(
      Object.keys(ELEVATED_CONTEXT_FILES).filter((file) =>
        file.startsWith("project/"),
      ),
    ).toEqual([]);
    expect(
      Object.keys(PROJECT_ELEVATED_CONTEXT_FILES).filter(
        (file) => !file.startsWith("project/"),
      ),
    ).toEqual([]);
  });

  it("每一筆都寫了理由", () => {
    for (const reason of [
      ...Object.values(ELEVATED_CONTEXT_FILES),
      ...Object.values(PROJECT_ELEVATED_CONTEXT_FILES),
    ]) {
      expect(reason.trim()).not.toBe("");
    }
  });

  it("新增一個未登記的提升上下文時掃描會抓到(暫存目錄裡放一份登記過、一份沒登記的)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "elevated-scan-"));
    try {
      const write = (relative: string, content: string): void => {
        mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
        writeFileSync(path.join(root, relative), content);
      };
      write("a/registered.ts", 'const c = { visibleOrgIds: "all" };');
      write("b/new-feature.ts", 'const c = { ...op, visibleOrgIds:"all" };');
      write("b/plain.ts", "const c = { visibleOrgIds: op.visibleOrgIds };");
      write("d/managed-only.ts", 'const c = { managedOrgIds: "all" };');
      write("c/skipped.test.ts", 'const c = { visibleOrgIds: "all" };');
      write("test-support/skipped.ts", 'const c = { visibleOrgIds: "all" };');
      const found = filesWithElevatedContext(root);
      expect(found).toEqual([
        "a/registered.ts",
        "b/new-feature.ts",
        "d/managed-only.ts",
      ]);
      expect(found).not.toEqual(["a/registered.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
