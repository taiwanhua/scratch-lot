import { AsyncLocalStorage } from "node:async_hooks";

import { Injectable, Logger } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import type { ClientSession, Connection } from "mongoose";

/**
 * 單一交易的預設上限(毫秒):整個 `withTransaction`(含寫入衝突的自動重試)超過就中止並回復。
 * 動作都應在毫秒級;與 MongoDB 伺服器的 `transactionLifetimeLimitSeconds` 預設值相同。
 */
export const TRANSACTION_TIMEOUT_MS = 60_000;

/** 交易成功提交後才執行的動作(送即時信號、寄信、GCS 複製…);失敗只記 log。 */
export type AfterCommitCallback = () => unknown;

export interface TransactionOptions {
  /** 整個交易的上限(毫秒);預設 `TRANSACTION_TIMEOUT_MS`。 */
  timeoutMs?: number;
}

/** 目前這個非同步呼叫鏈所在的交易:session 與交易後動作的佇列。 */
interface TransactionScope {
  readonly session: ClientSession;
  afterCommit: AfterCommitCallback[];
}

const transactionScope = new AsyncLocalStorage<TransactionScope>();
const logger = new Logger("Transaction");

/**
 * 交易的單一入口(ADR「引入 Mongo 交易」;用法見 `docs/standards/api/transactions.md`):
 * 一個使用者動作 = 一個交易,`fn` 裡任何一步拋錯,這個交易內的所有寫入一起回復。
 *
 * - 內部用 driver 的 `session.withTransaction`:寫入衝突等暫時性錯誤會**整個 `fn` 重跑**,
 *   所以 `fn` 裡不得有外部副作用(寄信、HTTP、GCS、Cloudflare),那些用 `afterCommit` 排到交易後
 * - `fn` 收到的 `session` 要傳給每一個讀寫;`BaseRepository` 沒帶 `session` 時自動用目前交易的
 * - 已在交易內再呼叫 → 加入同一個交易(不開巢狀交易),`fn` 拋錯一樣讓外層整個回復
 */
@Injectable()
export class TransactionService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  withTransaction<T>(
    fn: (session: ClientSession) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    return runTransaction(this.connection, fn, options);
  }
}

async function runTransaction<T>(
  connection: Connection,
  fn: (session: ClientSession) => Promise<T>,
  options: TransactionOptions,
): Promise<T> {
  const current = transactionScope.getStore();
  if (current !== undefined) {
    return fn(current.session);
  }

  const session = await connection.startSession();
  const scope: TransactionScope = { session, afterCommit: [] };
  let result: T;
  try {
    result = await transactionScope.run(scope, () =>
      session.withTransaction(
        () => {
          // 自動重試會重跑整個 fn:上一輪排進來的交易後動作屬於已回復的那次,一併丟棄
          scope.afterCommit = [];
          return fn(session);
        },
        { timeoutMS: options.timeoutMs ?? TRANSACTION_TIMEOUT_MS },
      ),
    );
  } finally {
    await session.endSession();
  }

  // 已在交易範圍外:交易後動作裡再呼叫外部服務不會被 `assertOutsideTransaction` 擋下
  await runAfterCommit(scope.afterCommit);
  return result;
}

async function runAfterCommit(
  callbacks: readonly AfterCommitCallback[],
): Promise<void> {
  for (const callback of callbacks) {
    try {
      await callback();
    } catch (error) {
      logger.error(
        `交易後動作失敗(交易已提交,不回復):${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}

/**
 * 在**目前交易**上登記一個交易後動作:交易成功提交後依登記順序執行,失敗只記 log;
 * 交易回復(或被自動重試丟掉的那一輪)則不執行。不在交易內呼叫即拋錯 —— 那代表呼叫端以為自己在交易裡。
 */
export function afterCommit(callback: AfterCommitCallback): void {
  const scope = transactionScope.getStore();
  if (scope === undefined) {
    throw new Error(
      "afterCommit 只能在 TransactionService.withTransaction 內呼叫",
    );
  }
  scope.afterCommit.push(callback);
}

/** 目前所在交易的 session;不在交易內回 undefined。 */
export function currentSession(): ClientSession | undefined {
  return transactionScope.getStore()?.session;
}

/**
 * 外部副作用的執行期防線:在交易內呼叫即拋錯(自動重試會讓副作用重複發生,回復時也收不回來)。
 * 每個對外 adapter 的入口(寄信、GCS 寫入、HTTP、Cloudflare)都要先呼叫它;應改用 `afterCommit`。
 */
export function assertOutsideTransaction(action: string): void {
  if (transactionScope.getStore() !== undefined) {
    throw new Error(
      `交易內不得${action}:外部副作用改用 afterCommit 排到交易成功之後`,
    );
  }
}
