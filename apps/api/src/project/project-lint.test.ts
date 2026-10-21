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
/** 會放排班程式的專案目錄(整棵掃,再用 `isScheduleSource` 挑出排班的檔)。 */
const PROJECT_ROOTS = [
  "apps/api/src/project",
  "apps/admin/src/pages/project",
  "apps/admin/src/components/project",
  "apps/admin/src/hooks/project",
  "apps/admin/src/mock/project",
  "packages/graphql/src/documents/project",
  "packages/domain/src/project",
];

/**
 * 排班的檔(repo 相對路徑,`/` 分隔):api / admin(頁面、元件、hooks、mock)/ documents 的 `project/schedule/` 底下,
 * 與 domain 的 `project/schedule-<主題>/`。
 */
const SCHEDULE_SOURCE_PATTERNS = [
  /^apps\/api\/src\/project\/schedule\//,
  /^apps\/admin\/src\/(?:pages|components|hooks|mock)\/project\/schedule\//,
  /^packages\/graphql\/src\/documents\/project\/schedule\//,
  /^packages\/domain\/src\/project\/schedule-[^/]+\//,
];

const isScheduleSource = (relativePath: string): boolean =>
  SCHEDULE_SOURCE_PATTERNS.some((pattern) => pattern.test(relativePath));

const repoRelative = (file: string): string =>
  path.relative(REPO_ROOT, file).split(path.sep).join("/");

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

  it.each([
    "apps/api/src/project/schedule/entries/entries.service.ts",
    "apps/admin/src/pages/project/schedule/manage/RosterPage.tsx",
    "apps/admin/src/components/project/schedule/ShiftChip/ShiftChip.tsx",
    "apps/admin/src/hooks/project/schedule/useRoster/useRoster.ts",
    "apps/admin/src/mock/project/schedule/roster-handlers.ts",
    "packages/graphql/src/documents/project/schedule/roster.graphql.ts",
    "packages/domain/src/project/schedule-fields/index.ts",
    "packages/domain/src/project/schedule-rules/index.ts",
  ])("排班的檔:%s", (relativePath) => {
    expect(isScheduleSource(relativePath)).toBe(true);
  });

  it.each([
    "apps/api/src/project/lottery/store/store.service.ts",
    "apps/api/src/project/notifications.ts",
    "apps/admin/src/hooks/project/useScanner/useScanner.ts",
    "apps/admin/src/mock/project/mock-world.ts",
    "packages/domain/src/project/reason-note/index.ts",
    "packages/domain/src/project/lottery-fields/index.ts",
    "packages/domain/src/project/scheduler/index.ts",
  ])("不是排班的檔:%s", (relativePath) => {
    expect(isScheduleSource(relativePath)).toBe(false);
  });

  it("排班的程式(api、admin 頁面 / 元件 / hooks / mock、documents、domain 的 schedule- 主題)沒有任何一處 import 刮刮樂", () => {
    const scheduleFiles = PROJECT_ROOTS.flatMap((root) =>
      codeFiles(path.join(REPO_ROOT, root)),
    ).filter((file) => isScheduleSource(repoRelative(file)));
    // 掃描清單沒有過期:現有的 domain 排班主題一定掃得到
    expect(scheduleFiles.map((file) => repoRelative(file))).toContain(
      "packages/domain/src/project/schedule-fields/index.ts",
    );
    const violations = scheduleFiles.flatMap((file) =>
      lotteryImportsOf(file, readFileSync(file, "utf8")).map(
        (specifier) => `${repoRelative(file)} → ${specifier}`,
      ),
    );
    expect(violations).toEqual([]);
  });
});
