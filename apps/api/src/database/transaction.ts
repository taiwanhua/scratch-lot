import { AsyncLocalStorage } from "node:async_hooks";

import { Injectable, Logger } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { GraphQLError } from "graphql";
import mongoose, { type ClientSession, type Connection } from "mongoose";

/**
 * 交易內的 Mongoose 操作自動帶 session(Mongoose 內建的 transactionAsyncLocalStorage):
 * `connection.transaction(fn)` 執行 `fn` 期間,沒有明確指定 `session` 的 query、`save()`、
 * `insertMany`、`bulkWrite` 都會用目前交易的 session —— 專屬 repository 也一樣涵蓋。
 * 明確給 `session`(含 `null`)時以明確值為準。這是 mongoose 實例的全域設定,資料層載入時就打開。
 */
mongoose.set("transactionAsyncLocalStorage", true);

/**
 * 單一交易的預設上限(毫秒):整個 `withTransaction`(含寫入衝突的自動重試)超過就中止並回復。
 * 動作都應在毫秒級;與 MongoDB 伺服器的 `transactionLifetimeLimitSeconds` 預設值相同。
 *
 * 由這裡自己計時,**不交給 driver 的 `withTransaction({ timeoutMS })`**:mongodb 7.x 會把交易的
 * `timeoutMS` 套到交易內每個操作,游標的 getMore 也被加上 `maxTimeMS`,server 拒絕
 * (non-awaitData cursor 不能帶),交易內讀超過一批(101 筆)就失敗。
 * 連線字串與 MongoClient 也不要設 `timeoutMS`:session 會繼承它,交易又會啟用同一套逾時。
 * 每次嘗試開始前、`fn` 結束後(提交前)各檢查一次,超過就拋 `TransactionTimeoutError` 讓 driver 回復;
 * 單一操作卡住時由伺服器的 `transactionLifetimeLimitSeconds` 中止交易,之後的重試再被這裡擋下。
 */
export const TRANSACTION_TIMEOUT_MS = 60_000;

/**
 * 交易逾時的錯誤碼(GQL-04):請求在 GraphQL 回 `extensions.code = TRANSACTION_TIMEOUT`,前端顯示
 * 「處理時間過長、已取消、資料沒有變更,請稍後再試」,不當成一般的未預期錯誤。
 */
export const TRANSACTION_TIMEOUT_CODE = "TRANSACTION_TIMEOUT";

/**
 * 交易超過上限:這次嘗試已回復,不再重試。是 `GraphQLError`(帶 `TRANSACTION_TIMEOUT_CODE`),
 * 從 resolver 拋出時前端分得出「逾時已回復」;排程、遷移等非 GraphQL 呼叫端照一般錯誤處理。
 */
export class TransactionTimeoutError extends GraphQLError {
  constructor(readonly timeoutMs: number) {
    super(`transaction exceeded ${String(timeoutMs)}ms and was rolled back`, {
      extensions: { code: TRANSACTION_TIMEOUT_CODE, timeoutMs },
    });
    this.name = "TransactionTimeoutError";
  }
}

/** 交易成功提交後才執行的動作(送即時信號、寄信、GCS 複製、快取作廢…);失敗只記 log。 */
export type AfterCommitCallback = () => unknown;

export interface TransactionOptions {
  /** 交易上限(毫秒),在每次嘗試開始前與 `fn` 結束後檢查,提交本身不計入;預設 `TRANSACTION_TIMEOUT_MS`。 */
  timeoutMs?: number;
}

/**
 * 交易的**一次嘗試**:session 與這次嘗試登記的交易後動作。
 * `open` 只在這次嘗試進行中為 true;嘗試結束(提交、回復、被重試取代)就關閉 ——
 * `fn` 裡排出去、晚於交易結束才跑的非同步工作(setTimeout 等)不會再被當成「在交易內」。
 * `open` 要等 `connection.transaction()` 返回才關,driver 提交(或回復)後到返回之間還有收尾空檔,
 * 所以 `activeScope()` 另看 driver 的 `session.inTransaction()`。
 */
interface TransactionScope {
  readonly session: ClientSession;
  readonly afterCommit: AfterCommitCallback[];
  open: boolean;
}

const transactionScope = new AsyncLocalStorage<TransactionScope>();
const logger = new Logger("Transaction");

/**
 * 進行中的嘗試:這次嘗試還沒被關閉,**而且** driver 仍在交易中。
 * - `inTransaction()` 在 driver 送出提交 / 回復並得到結果的那一刻轉為 false,不必等 withTransaction 返回
 * - 重試時同一個 session 會重新 `startTransaction`(又回到 true),上一輪靠 `open` 擋掉
 */
function activeScope(): TransactionScope | undefined {
  const scope = transactionScope.getStore();
  return scope?.open === true && scope.session.inTransaction()
    ? scope
    : undefined;
}

/**
 * 交易的單一入口(ADR-0013;用法見 `docs/standards/api/transactions.md`):
 * 一個使用者動作 = 一個交易,`fn` 裡任何一步拋錯,這個交易內的所有寫入一起回復。
 *
 * - 內部用 Mongoose 的 `connection.transaction`(driver 的 `session.withTransaction`):寫入衝突等
 *   暫時性錯誤會**整個 `fn` 重跑**(Mongoose 並在重試前重設文件狀態),所以 `fn` 裡不得有外部副作用,
 *   那些用 `afterCommit` 排到交易後
 * - `fn` 收到的 `session` 要傳給每一個讀寫;沒傳時 Mongoose 操作也會自動帶上(見檔頭)
 * - 已在交易內再呼叫 → 直接在同一個交易裡執行 `fn`,**沒有獨立的回復點**:內層拋錯若被外層接住後
 *   繼續,內層已做的寫入會隨外層一起提交;要回復就讓錯誤一路往外拋
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
  const current = activeScope();
  if (current !== undefined) {
    return fn(current.session);
  }

  const timeoutMs = options.timeoutMs ?? TRANSACTION_TIMEOUT_MS;
  const deadline = performance.now() + timeoutMs;
  // 拋一般 Error(非 MongoError)時 driver 會回復這次嘗試並直接往外拋,不重試
  const assertWithinDeadline = (): void => {
    if (performance.now() >= deadline) {
      throw new TransactionTimeoutError(timeoutMs);
    }
  };

  let attempt: TransactionScope | undefined;
  let result: T;
  try {
    // 不給 driver timeoutMS(原因見 TRANSACTION_TIMEOUT_MS);重試總時長另有 driver 內建的 120 秒上限
    result = await connection.transaction(async (session) => {
      // 自動重試會重跑整個 fn:上一輪(含它登記的交易後動作)屬於已回復的那次,關閉並丟棄
      if (attempt !== undefined) {
        attempt.open = false;
      }
      assertWithinDeadline();
      const scope: TransactionScope = {
        session,
        afterCommit: [],
        open: true,
      };
      attempt = scope;
      const value = await transactionScope.run(scope, () => fn(session));
      assertWithinDeadline();
      return value;
    });
  } finally {
    if (attempt !== undefined) {
      attempt.open = false;
    }
  }

  await runAfterCommit(attempt?.afterCommit ?? []);
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
 * 在**目前交易**上登記一個交易後動作:交易成功提交後依登記順序執行(算進這個請求的回應時間),
 * 失敗只記 log;交易回復(或被自動重試丟掉的那一輪)則不執行。
 * 不在進行中的交易內呼叫即拋錯 —— 那代表呼叫端以為自己在交易裡。
 */
export function afterCommit(callback: AfterCommitCallback): void {
  const scope = activeScope();
  if (scope === undefined) {
    throw new Error(
      "afterCommit 只能在 TransactionService.withTransaction 進行中呼叫",
    );
  }
  scope.afterCommit.push(callback);
}

/** 目前進行中交易的 session;不在交易內(或交易已結束)回 undefined。 */
export function currentSession(): ClientSession | undefined {
  return activeScope()?.session;
}

/**
 * 外部副作用的執行期防線:在進行中的交易內呼叫即拋錯(自動重試會讓副作用重複發生,回復時也收不回來)。
 * 每個對外 adapter 的入口(寄信、GCS 寫入、HTTP、Cloudflare)都要先呼叫它;應改用 `afterCommit`。
 */
export function assertOutsideTransaction(action: string): void {
  if (activeScope() !== undefined) {
    throw new Error(
      `交易內不得${action}:外部副作用改用 afterCommit 排到交易成功之後`,
    );
  }
}
