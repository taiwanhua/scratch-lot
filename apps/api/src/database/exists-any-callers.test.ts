import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

import { EXISTS_ANY_CALLERS, TENANT_BOUNDARY_CALLERS } from "./base.repository";

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
 * 跨租戶 aggregate 的標記(`markCrossTenantAggregate`)是 ADR-0005 登記的系統出口:
 * 只給退役權限清理的跨租戶計數,其他 aggregate 一律經 `BaseRepository.aggregate`。
 */
describe("跨租戶 aggregate 出口的呼叫端登記", () => {
  it("markCrossTenantAggregate 只出現在定義它的檔、plugin 與 form-submission-usage.ts", () => {
    expect(filesMentioning("CrossTenantAggregate")).toEqual([
      "database/form-submission-usage.ts",
      "database/operator-context.ts",
      "database/plugins/tenant-scope.plugin.ts",
    ]);
  });
});
