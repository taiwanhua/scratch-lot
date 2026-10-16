import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "@jest/globals";

import { DailyFileLogger, expiredLogFiles, logFileName } from "./logger";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const tempDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "print-agent-log-"));
  dirs.push(dir);
  return dir;
};

describe("紀錄:每天一個檔、保留 14 天", () => {
  it("檔名用本機日期", () => {
    expect(logFileName(new Date(2026, 9, 7, 23, 59))).toBe(
      "print-agent-2026-10-07.log",
    );
  });

  it("含今天保留 14 天:第 15 天前的檔要刪,其他檔名不碰", () => {
    const names = [
      "print-agent-2026-10-03.log",
      "print-agent-2026-10-04.log",
      "print-agent-2026-10-17.log",
      "other.log",
    ];
    expect(expiredLogFiles(names, new Date(2026, 9, 17, 8))).toEqual([
      "print-agent-2026-10-03.log",
    ]);
  });

  it("換日寫到新檔,並刪掉過期的檔;金鑰之類的欄位不會自己出現", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "print-agent-2026-09-01.log"), "old\n");
    let now = new Date(2026, 9, 16, 23, 59);
    const logger = new DailyFileLogger({ dir, now: () => now });
    logger.info("第一天", { jobId: "j1" });
    now = new Date(2026, 9, 17, 0, 1);
    logger.warn("第二天");
    expect(
      readdirSync(dir).toSorted((a, b) => a.localeCompare(b, "zh-Hant")),
    ).toEqual(["print-agent-2026-10-16.log", "print-agent-2026-10-17.log"]);
    const first = readFileSync(
      path.join(dir, "print-agent-2026-10-16.log"),
      "utf8",
    );
    expect(first).toContain('INFO 第一天 jobId="j1"');
  });
});
