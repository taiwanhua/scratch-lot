import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

/**
 * 專案來源對裸查禁令(`@repo/no-raw-model-query`,ADR-0005)的精確豁免清單。
 * 規則本身的正負例由共用的 `database/no-raw-model-query.test.ts` 驗;這裡只守「專案多了一個豁免就紅」。
 */
const RULE_ID = "@repo/no-raw-model-query";
const SRC_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SRC_ROOT, "..", "..", "..");

/** 目錄下的正式程式檔(不含測試檔)。 */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return entry.endsWith(".ts") && !entry.endsWith(".test.ts") ? [full] : [];
  });
}

describe("ESLint 裸查禁令:專案來源的豁免清單", () => {
  it("專案來源沒有任何豁免(資料存取一律經 BaseRepository)", () => {
    const waived = sourceFiles(path.join(SRC_ROOT, "project"))
      .filter((file) => readFileSync(file, "utf8").includes(RULE_ID))
      .map((file) => path.relative(SRC_ROOT, file).split(path.sep).join("/"));
    expect(waived).toEqual([]);
  });
});

/**
 * 依賴方向:刮刮樂 → 排班(專案規格第 0 章)。排班是獨立的專案模組,不得 import 任何刮刮樂的路徑;
 * 排班表要顯示的刮刮樂資料(例:收銀點名稱)由刮刮樂以登記方式提供給排班。
 * 目錄約定見 `apps/api/src/project/README.md`、`apps/admin/src/pages/project/README.md`。
 */
const SCHEDULE_ROOTS = [
  "apps/api/src/project/schedule",
  "apps/admin/src/pages/project/schedule",
  "apps/admin/src/components/project/schedule",
  "packages/graphql/src/documents/project/schedule",
  "packages/domain/src/project/schedule-fields",
];

const IMPORT_SPECIFIER =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

/** 路徑的任一段以 `lottery` 開頭(`lottery/`、`lottery-fields`、`lottery_games`…)就算刮刮樂。 */
const isLotteryPath = (value: string): boolean =>
  value.split(/[/\\]/).some((segment) => segment.startsWith("lottery"));

/** 一個檔裡指向刮刮樂的 import(相對路徑先解析成 repo 內的實際位置再判斷)。 */
function lotteryImportsOf(file: string, content: string): readonly string[] {
  const offending: string[] = [];
  for (const [, specifier = ""] of content.matchAll(IMPORT_SPECIFIER)) {
    const target = specifier.startsWith(".")
      ? path.relative(REPO_ROOT, path.resolve(path.dirname(file), specifier))
      : specifier;
    if (isLotteryPath(target)) {
      offending.push(specifier);
    }
  }
  return offending;
}

/** 目錄下全部 ts / tsx(含測試檔:測試也不得依賴刮刮樂)。 */
function codeFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      return codeFiles(full);
    }
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("依賴方向:排班不得 import 刮刮樂", () => {
  const scheduleFile = path.join(
    REPO_ROOT,
    "apps/api/src/project/schedule/x.ts",
  );

  it("反例:project/schedule/x.ts import ../lottery/y → 抓到", () => {
    expect(
      lotteryImportsOf(scheduleFile, 'import { y } from "../lottery/y";'),
    ).toEqual(["../lottery/y"]);
  });

  it("反例:套件路徑、動態 import、繞到刮刮樂目錄的相對路徑也抓到", () => {
    const content = [
      'import { LOTTERY_FIELD_CATEGORY_KEYS } from "@repo/domain/project/lottery-fields";',
      'const page = import("../../../../admin/src/pages/project/lottery/store/StorePage");',
      'export * from "./../lottery";',
    ].join("\n");
    expect(lotteryImportsOf(scheduleFile, content)).toEqual([
      "@repo/domain/project/lottery-fields",
      "../../../../admin/src/pages/project/lottery/store/StorePage",
      "./../lottery",
    ]);
  });

  it("正例:排班自己的路徑、底座與共用的專案主題不算", () => {
    const content = [
      'import { requiresReasonNote } from "@repo/domain/project/reason-note";',
      'import { SCHEDULE_FIELD_CATEGORY_KEYS } from "@repo/domain/project/schedule-fields";',
      'import { BaseRepository } from "../../database/base-repository";',
      'import { entries } from "./entries";',
    ].join("\n");
    expect(lotteryImportsOf(scheduleFile, content)).toEqual([]);
  });

  it("排班的程式(api、admin 頁面與元件、documents、domain 主題)沒有任何一處 import 刮刮樂", () => {
    const violations = SCHEDULE_ROOTS.flatMap((root) =>
      codeFiles(path.join(REPO_ROOT, root)),
    ).flatMap((file) =>
      lotteryImportsOf(file, readFileSync(file, "utf8")).map(
        (specifier) =>
          `${path.relative(REPO_ROOT, file).split(path.sep).join("/")} → ${specifier}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});
