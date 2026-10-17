import { AsyncLocalStorage } from "node:async_hooks";

import { jest } from "@jest/globals";

import type { AuthTestApp } from "../../auth/test-support/auth-app";
import { WorkflowEngineHooks } from "../workflow-engine/workflow-engine.service";

/**
 * 引擎檢查點的測試接縫(TEST-07 的第二個接縫,理由見 `WorkflowEngineHooks`):
 * 讓某個檢查點在第 `nth` 次走到時丟錯(模擬中斷;檢查點在交易內 → 整個動作回復),或插進一段動作
 * (控制交錯)。回復原狀的函式。
 */
export function interruptAt(
  api: AuthTestApp,
  checkpoint: string,
  nth = 1,
): () => void {
  const hooks = api.app.get(WorkflowEngineHooks);
  let seen = 0;
  const spy = jest
    .spyOn(hooks, "reached")
    .mockImplementation((reached: string) => {
      if (reached === checkpoint) {
        seen += 1;
        if (seen === nth) {
          return Promise.reject(new Error(`模擬中斷:${checkpoint}`));
        }
      }
      return Promise.resolve();
    });
  return () => {
    spy.mockRestore();
  };
}

/**
 * 走到某個檢查點(第一次)時先做 `action`,再繼續原本的流程 —— 模擬「另一個請求在這一刻完成並提交」。
 *
 * `action` 在**交易外**執行(以建立接縫當下的非同步脈絡跑,不繼承檢查點所在交易的 session),自成一個請求、
 * 自己提交;原本的交易之後寫到同一份文件 → 寫入衝突、整個交易重跑(重跑時不再插入)。
 * 只能插在原本交易**寫入之前**的檢查點(`*:before-write`、推進的 `action:*` 在第一次寫入前):插在寫入之後,
 * `action` 會等原本交易的鎖,而原本交易在等 `action`。
 */
export function interleaveAt(
  api: AuthTestApp,
  checkpoint: string,
  action: () => Promise<unknown>,
): () => void {
  const hooks = api.app.get(WorkflowEngineHooks);
  const outsideTransaction = AsyncLocalStorage.snapshot();
  let isDone = false;
  const spy = jest
    .spyOn(hooks, "reached")
    .mockImplementation(async (reached: string) => {
      if (reached === checkpoint && !isDone) {
        isDone = true;
        await outsideTransaction(action);
      }
    });
  return () => {
    spy.mockRestore();
  };
}
