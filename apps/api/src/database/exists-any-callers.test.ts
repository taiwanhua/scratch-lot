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

import {
  EXISTS_ANY_CALLERS,
  ORG_REASSIGN_CALLERS,
  TENANT_BOUNDARY_CALLERS,
} from "./base.repository";

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

function filesMentioning(needle: string): string[] {
  return sourceFiles(SRC_ROOT)
    .filter((file) => readFileSync(file, "utf8").includes(needle))
    .map((file) => path.relative(SRC_ROOT, file).split(path.sep).join("/"))
    .toSorted((left, right) => left.localeCompare(right));
}

/**
 * `BaseRepository.existsAny` 是 ADR-0005 登記的例外出口(略過資料範圍規則、租戶過濾照套):
 * 只給前置檢查回答「有沒有」,一般列表 / 詳情不得借用。
 */
describe("存在性檢查(existsAny)的呼叫端登記", () => {
  it("正式程式碼裡出現 existsAny 的檔案都在登記清單內(方法本身所在的檔除外)", () => {
    const callers = filesMentioning("existsAny").filter(
      (file) => file !== "database/base.repository.ts",
    );
    expect(callers).toEqual(
      [...EXISTS_ANY_CALLERS].toSorted((left, right) =>
        left.localeCompare(right),
      ),
    );
  });

  it("略過規則的查詢旗標只在資料層內出現(只能經 existsAny 設定)", () => {
    expect(filesMentioning("existenceCheck")).toEqual([
      "database/base.repository.ts",
      "database/operator-context.ts",
      "database/plugins/tenant-scope.plugin.ts",
    ]);
  });
});

/**
 * 租戶邊界出口(`existsInTenant` / `findRefsInTenant`)同樣是 ADR-0005 登記的例外出口:
 * 以**呼叫語法**(`.existsInTenant(` / `.findRefsInTenant(`)掃,註解裡提到方法名不算。
 */
describe("租戶邊界出口的呼叫端登記", () => {
  it("正式程式碼裡呼叫 existsInTenant / findRefsInTenant 的檔案都在登記清單內", () => {
    const callers = [
      ...new Set([
        ...filesMentioning(".existsInTenant("),
        ...filesMentioning(".findRefsInTenant("),
      ]),
    ]
      .filter((file) => file !== "database/base.repository.ts")
      .toSorted((left, right) => left.localeCompare(right));
    expect(callers).toEqual(
      [...TENANT_BOUNDARY_CALLERS].toSorted((left, right) =>
        left.localeCompare(right),
      ),
    );
  });

  it("略過可見範圍的租戶邊界旗標只在資料層內出現(只能經那兩個方法設定)", () => {
    expect(filesMentioning("tenantBoundary:")).toEqual([
      "database/base.repository.ts",
    ]);
  });
});

/**
 * 原生驅動的 aggregate(`model.collection.aggregate`)不經 tenantScopePlugin 的 aggregate 中介層:
 * 只准出現在 ADR-0005 登記的跨租戶計數 `form-submission-usage.ts`;其他 aggregate 一律經
 * `BaseRepository.aggregate`(沒帶上下文就拋錯)。
 */
describe("原生 aggregate 與原生 collection 存取的位置", () => {
  it("原生 aggregate(.collection 之後接 .aggregate)只出現在 form-submission-usage.ts", () => {
    const pattern = /\.collection\s*\.aggregate\b/;
    const files = sourceFiles(SRC_ROOT)
      .filter((file) => pattern.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC_ROOT, file).split(path.sep).join("/"));
    expect(files).toEqual(["database/form-submission-usage.ts"]);
  });

  it("原生 collection 存取(`.collection(` 取 Connection 上的表)只出現在 database/(no-raw-model-query 只認 Model,抓不到 Connection)", () => {
    const files = sourceFiles(SRC_ROOT)
      // 測試輔助(`test-support/` 與 `*-test-support.ts`)只給測試用
      .filter((file) => !file.includes("test-support"))
      .filter((file) => readFileSync(file, "utf8").includes(".collection("))
      .map((file) => path.relative(SRC_ROOT, file).split(path.sep).join("/"))
      .filter((file) => !file.startsWith("database/"));
    expect(files).toEqual([]);
  });
});

/** `root` 底下(測試檔除外)以呼叫語法 `.reassignOrg(` 呼叫搬家的檔案(相對 root、`/` 分隔、排序)。 */
function reassignCallersUnder(root: string): string[] {
  return sourceFiles(root)
    .filter((file) => readFileSync(file, "utf8").includes(".reassignOrg("))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .filter((file) => file !== "database/base.repository.ts")
    .toSorted((left, right) => left.localeCompare(right));
}

/**
 * 搬家(`reassignOrg`)是 ADR-0005 登記的例外出口(一般更新不准改 `orgId`):
 * 以呼叫語法掃,只准登記過的檔案呼叫。
 */
describe("搬家(reassignOrg)的呼叫端登記", () => {
  it("正式程式碼裡呼叫 reassignOrg 的檔案都在登記清單內", () => {
    expect(reassignCallersUnder(SRC_ROOT)).toEqual(
      [...ORG_REASSIGN_CALLERS].toSorted((left, right) =>
        left.localeCompare(right),
      ),
    );
  });

  it("新增一個未登記的呼叫端時掃描會抓到(暫存目錄裡放一份呼叫、一份只在註解提到)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "reassign-scan-"));
    try {
      const write = (relative: string, content: string): void => {
        mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
        writeFileSync(path.join(root, relative), content);
      };
      write(
        "transfer/transfer.service.ts",
        "await repo.reassignOrg(op, f, to);",
      );
      write("notes/readme.ts", "// 搬家用 reassignOrg");
      write("transfer/transfer.test.ts", "await repo.reassignOrg(op, f, to);");
      const found = reassignCallersUnder(root);
      expect(found).toEqual(["transfer/transfer.service.ts"]);
      expect(found).not.toEqual([...ORG_REASSIGN_CALLERS]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
