import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, jest } from "@jest/globals";
import { Types } from "mongoose";

import type {
  FormEffectContext,
  FormLifecycleRegistration,
} from "../../../workflows/workflow-engine/lifecycle/form-lifecycle-registration";
import { purchaseLifecycle } from "../purchase/purchase-lifecycle";
import { transferLifecycle } from "../transfer/transfer-lifecycle";
import { settlementMarkReopenGuard } from "./settlement-guard";
import { SettlementMarks } from "./settlement-marks";

const SRC_ROOT = path.resolve(__dirname, "..", "..", "..");

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

const count = (text: string, pattern: RegExp): number =>
  [...text.matchAll(pattern)].length;

/**
 * 結清標記不能漏記(待結清只掃還沒結清的;正本 `docs/modules/project/accounts.md`「待結清款項與側欄數字」):
 * 標記只在兩種時機改 —— 單據完成 / 已完成單據被修改(掛接點),與每一筆收付寫入(帳本寫入口)。
 * 新增收付單據或新的帳本寫入口時,這裡會失敗,提醒一起掛上。
 */
describe("結清標記的掛接(靜態檢查)", () => {
  const files = sourceFiles(SRC_ROOT);

  it("登記收付的單據只有進貨單、調貨單;兩個的掛接點都建標記(completed)、修改已完成單據時改回待確認(beforeEditCompleted)", async () => {
    const registering = files
      .filter((file) =>
        readFileSync(file, "utf8").includes("registerSettlementDocument({"),
      )
      .map((file) => relative(file))
      // 登記介面本身(註解裡有範例)
      .filter((file) => !file.endsWith("settlement/settlement-registry.ts"))
      .toSorted((left, right) => left.localeCompare(right));
    expect(registering).toEqual([
      "project/lottery/purchase/purchase-registrations.ts",
      "project/lottery/transfer/transfer-registrations.ts",
    ]);
    for (const lifecycle of [purchaseLifecycle, transferLifecycle] as const) {
      await expectMarksWired(lifecycle);
    }
  });

  it("帳本(銀行交易、現金流水)只由兩個寫入口新增,每一個新增之後都 touch 標記", () => {
    const writers = new Map<string, number>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const fields = [
        ...text.matchAll(
          /private readonly (\w+): Lottery(?:BankTransactions|CashMovements)Repository/gu,
        ),
      ].map((match) => match[1]);
      const creates = fields.reduce(
        (sum, field) =>
          sum +
          count(
            text,
            new RegExp(
              String.raw`this\.${String(field)}\.create(?:Many)?\(`,
              "gu",
            ),
          ),
        0,
      );
      if (creates > 0) {
        writers.set(relative(file), creates);
        expect({
          file: relative(file),
          touches: count(text, /await this\.touchSettlement\(/gu),
        }).toEqual({ file: relative(file), touches: creates });
      }
    }
    expect(Object.fromEntries(writers)).toEqual({
      "project/lottery/accounts/bank-transactions.service.ts": 2,
      "project/lottery/cash/cash-ledger.service.ts": 2,
    });
  });
});

/** 一筆登記的結清標記掛接:inject 有 `SettlementMarks`、修改已完成單據的守門、完成時建標記。 */
async function expectMarksWired(
  lifecycle: FormLifecycleRegistration,
): Promise<void> {
  expect(lifecycle.inject).toContain(SettlementMarks);
  expect(lifecycle.guards?.beforeEditCompleted).toBe(settlementMarkReopenGuard);
  const completed = jest.fn<(...args: unknown[]) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const context = {
    submissionId: new Types.ObjectId(),
    orgId: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    moduleKey: lifecycle.moduleKey,
    session: {},
    // 規則的事後動作(側欄信號)換成空函式
    get: (token: unknown) =>
      token === SettlementMarks ? { completed } : { onTaskEnded: () => null },
  } as unknown as FormEffectContext;
  await lifecycle.effects?.completed?.(context);
  expect(completed).toHaveBeenCalledWith(
    context.session,
    expect.objectContaining({ _id: context.submissionId }),
  );
}
