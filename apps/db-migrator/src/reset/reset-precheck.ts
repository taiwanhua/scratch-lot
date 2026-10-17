/**
 * `data` 模式刪除之前的唯讀預檢(`docs/concepts/data-layer-and-isolation.md`「還原」):
 * 有任何做到一半的東西就**整次拒絕**,不替它續發、也不把半成品清掉。
 *
 * - 未完成的 update:migration 停在 preparing / started / verified、還原(down)做到一半、
 *   最近一次會套種子的執行沒有走完、受管定義的安裝紀錄還是 in-progress(`update/journal.ts`)
 * - 底座交易化(ADR-0013)之前留下的中斷發布 / 退役:**所有**表單與流程(`update/interrupted-lifecycles.ts`,
 *   與 update 預檢同一支);新版的發布與退役是交易,不會再產生,但不清庫的升級可能還留著舊資料
 *
 * 操作者先以同一個 revision 的來源執行 update 把它做完(舊中斷依 `docs/deployment.md` 手動補完),再明確執行 reset。
 * `full` 不經這一段:它已明確要清庫,未完成的安裝會一起清掉再依所選版本重建。
 */
import type { Db } from "mongodb";

import { definitionSeedId } from "@repo/domain/seed";

import { findInterruptedLifecycles } from "../update/interrupted-lifecycles";
import { findOpenMigrations, findUnfinishedUpdate } from "../update/journal";

/** 預檢沒過;`blockers` 逐項列出。此時還沒有刪除任何資料。 */
export class ResetPrecheckError extends Error {
  override name = "ResetPrecheckError";

  constructor(readonly blockers: readonly string[]) {
    super(
      `data reset 預檢未通過(尚未刪除任何資料):\n- ${blockers.join("\n- ")}\n請先以同一版來源執行 update 接續完成(舊版留下的發布 / 退役中斷依 docs/deployment.md 手動補完),再明確執行 reset;預檢不會替它續做或清掉半成品`,
    );
  }
}

/**
 * 目前擋住 `data` reset 的所有項目(唯讀;沒有就是空陣列)。`runId`:呼叫端自己這一次不列入。
 */
export async function findResetBlockers(
  database: Db,
  runId: string,
): Promise<string[]> {
  const unfinished = await findUnfinishedUpdate(database, runId);
  const open = await findOpenMigrations(database);
  const blockers = [
    ...unfinished.migrations.map(
      ({ fileName, status }) => `migration ${fileName} 未完成(${status})`,
    ),
    ...open
      .filter(({ status }) => status === "rollback-in-progress")
      .map(
        ({ fileName }) =>
          `migration ${fileName} 的還原(down)尚未完成(rollback-in-progress)`,
      ),
    ...unfinished.installations.map(
      (item) =>
        `受管定義 ${definitionSeedId(item)} 的安裝尚未完成(in-progress)`,
    ),
  ];
  if (unfinished.run !== null) {
    const { operation, runId: unfinishedRun, status, stage } = unfinished.run;
    blockers.push(
      `最近一次 ${operation}(run ${unfinishedRun})沒有走完:${status},停在 ${stage} 階段`,
    );
  }
  blockers.push(...(await findInterruptedLifecycles(database)));
  return blockers;
}
