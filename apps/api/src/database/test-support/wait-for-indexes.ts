import type { INestApplication } from "@nestjs/common";
import { getConnectionToken } from "@nestjs/mongoose";
import type { Connection } from "mongoose";

/**
 * 等 app 的每張 model 建好 collection 與索引(Mongoose `autoCreate` / `autoIndex` 在連線後**非同步**進行,
 * `app.init()` 不等它們)。不等完就開始測,測試的第一批交易會撞上同一張表的 catalog 變動
 * (`WriteConflict … due to catalog changes`、`LockTimeout`,TransientTransactionError),被 driver
 * 整個重跑 —— 「只查一次」這類計數斷言因此在負載高的全套並行時偶發失敗;唯一索引也可能還沒生效。
 * `Model.init()` 回的是同一個建立中的 promise,重複呼叫不會重建。
 */
export async function waitForCollectionsAndIndexes(
  app: INestApplication,
): Promise<void> {
  const appConnection = app.get<Connection>(getConnectionToken());
  await Promise.all(
    Object.values(appConnection.models).map((model) => model.init()),
  );
}
