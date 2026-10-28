import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

const SRC_ROOT = path.resolve(__dirname, "..", "..", "..");

/** BaseRepository 會寫入的方法(讀取方法不列)。 */
const WRITE_METHODS = [
  "create",
  "createMany",
  "updateById",
  "updateMany",
  "findOneAndUpdate",
  "findOwnAndUpdate",
  "bulkUpdateByIds",
  "softDeleteById",
  "softDeleteMany",
  "hardDeleteById",
  "hardDeleteDraft",
  "reassignOrg",
  "reassignOrgMany",
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      return entry === "test-support" ? [] : sourceFiles(full);
    }
    return entry.endsWith(".ts") && !entry.endsWith(".test.ts") ? [full] : [];
  });
}

const relative = (file: string): string =>
  path.relative(SRC_ROOT, file).split(path.sep).join("/");

/**
 * 一個檔裡對某型別 repository 的寫入呼叫:`<欄位>.<寫入方法>(` 到呼叫結束的片段。
 * 欄位名從整個檔 `text` 找;`within` = 只找這一段(例如某個方法本體)。
 */
function writeCallsOf(
  text: string,
  repositoryType: string,
  within: string = text,
): string[] {
  const fields = new Set(
    [
      ...text.matchAll(
        new RegExp(String.raw`(\w+)\??: ${repositoryType}\b`, "gu"),
      ),
    ].map((match) => String(match[1])),
  );
  return [...fields].flatMap((field) =>
    [
      ...within.matchAll(
        new RegExp(
          // 單行呼叫到行尾的 `);`;多行呼叫到單獨一行的 `);`
          String.raw`\b${field}\.(?:${WRITE_METHODS.join("|")})\((?:[^\n]*\);|[\s\S]*?\n\s*\);)`,
          "gu",
        ),
      ),
    ].map((match) => match[0]),
  );
}

/** 類別方法的本體(從宣告到下一個同層方法宣告或類別結尾)。 */
function methodBody(text: string, name: string): string {
  const start = text.search(
    new RegExp(String.raw`^  (?:private |public )?(?:async )?${name}\(`, "mu"),
  );
  if (start < 0) {
    throw new Error(`找不到方法 ${name}`);
  }
  const rest = text.slice(start + 1);
  const end = rest.search(
    /^ {2}(?:\/\*\*|(?:private |public )?(?:async )?\w+\()|^\}/mu,
  );
  return end < 0 ? rest : rest.slice(0, end);
}

const count = (text: string, pattern: RegExp): number =>
  [...text.matchAll(pattern)].length;

/**
 * 張的狀態、位置、所在分店只經帳本服務改,且每一次改都在同一個交易寫張數事件
 * (正本 `lottery-ticket.schema.ts`、`lottery-ticket-event.schema.ts`;專案規格 7.1 / 7.2、第 20 章已知限制)。
 * 營運報表與盤點以事件往回推算,漏寫事件就對不上。新增寫入口時這裡會失敗,提醒改走帳本服務。
 */
describe("張的寫入只經帳本服務(靜態檢查)", () => {
  const files = sourceFiles(SRC_ROOT).map((file) => ({
    file: relative(file),
    text: readFileSync(file, "utf8"),
  }));

  it("張 repository 的寫入只出現在帳本服務與建本(建本同時寫進貨事件)", () => {
    const writers = Object.fromEntries(
      files.flatMap(({ file, text }) => {
        const calls = writeCallsOf(text, "LotteryTicketsRepository");
        return calls.length > 0 ? [[file, calls.length]] : [];
      }),
    );
    expect(writers).toEqual({
      // 狀態寫入(updateMany + 換店 reassignOrgMany)與改鎖(updateMany)
      "project/lottery/tickets/ticket-ledger.service.ts": 3,
      "project/lottery/tickets/books.service.ts": 1,
    });
  });

  it("張數事件只新增(沒有任何更新 / 刪除),也只由帳本服務與建本寫", () => {
    const writers = Object.fromEntries(
      files.flatMap(({ file, text }) => {
        const calls = writeCallsOf(text, "LotteryTicketEventsRepository");
        return calls.length > 0 ? [[file, calls]] : [];
      }),
    );
    expect(
      Object.keys(writers).toSorted((left, right) => left.localeCompare(right)),
    ).toEqual([
      "project/lottery/tickets/books.service.ts",
      "project/lottery/tickets/ticket-ledger.service.ts",
    ]);
    for (const calls of Object.values(writers)) {
      for (const call of calls) {
        expect(call).toMatch(/^\w+\.createMany\(/u);
      }
    }
  });

  it("每一處張的寫入都帶交易 session,且同一個流程寫事件(改鎖只動鎖、不算張數變化)", () => {
    const ledger = files.find((entry) =>
      entry.file.endsWith("tickets/ticket-ledger.service.ts"),
    )?.text;
    const books = files.find((entry) =>
      entry.file.endsWith("tickets/books.service.ts"),
    )?.text;
    if (ledger === undefined || books === undefined) {
      throw new Error("找不到帳本服務或建本服務");
    }
    for (const call of [
      ...writeCallsOf(ledger, "LotteryTicketsRepository"),
      ...writeCallsOf(books, "LotteryTicketsRepository"),
      ...writeCallsOf(ledger, "LotteryTicketEventsRepository"),
      ...writeCallsOf(books, "LotteryTicketEventsRepository"),
    ]) {
      expect(call).toMatch(/\bsession\b/u);
    }

    // 狀態寫入:updateTickets 只由 writeStage 呼叫,writeStage 只由 applyTicketEvents 呼叫,
    // applyTicketEvents 在同一個 session 寫事件
    expect(
      writeCallsOf(
        ledger,
        "LotteryTicketsRepository",
        methodBody(ledger, "updateTickets"),
      ),
    ).toHaveLength(2);
    expect(count(ledger, /this\.updateTickets\(/gu)).toBe(1);
    expect(methodBody(ledger, "writeStage")).toContain("this.updateTickets(");
    expect(count(ledger, /this\.writeStage\(/gu)).toBe(1);
    const apply = methodBody(ledger, "applyTicketEvents");
    expect(apply).toContain("this.writeStage(");
    expect(apply).toContain("this.events.createMany(");

    // 改鎖:只改 lockedBy(與版本),不動狀態、位置、所在分店,所以不寫事件
    const [lockWrite, ...otherLockWrites] = writeCallsOf(
      ledger,
      "LotteryTicketsRepository",
      methodBody(ledger, "changeLockIn"),
    );
    expect(otherLockWrites).toEqual([]);
    expect(lockWrite).toContain("$set: { lockedBy: to }, $inc: { version: 1 }");

    // 建本:同一個方法建張、寫進貨事件
    const create = methodBody(books, "createBook");
    expect(create).toContain("this.tickets.createMany(");
    expect(create).toContain("this.events.createMany(");
  });
});
