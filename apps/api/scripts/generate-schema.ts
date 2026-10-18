/**
 * 重生 `apps/api/schema.gql`(GQL-05:schema 是產物,不手改)。
 *
 * 跑法:`pnpm --filter @repo/api schema:generate`
 *
 * 做法:schema 由 GraphQLModule 在 **app 啟動時**寫檔,所以這裡就是啟一次完整的 AppModule 再關掉 —
 * 不另外列一份 resolver 清單(列了就會跟 app.module.ts 漂移,漏掉的型別不會進 schema 也沒人發現)。
 * 兩個前置:
 * - `NODE_ENV` 必須不是 `test`(app.module.ts 在 test 下改用記憶體 schema,不寫檔),且要在 import 之前設 —
 *   AppModule 載入當下 ConfigModule 就讀 `.env`、sandbox 開關也讀掉 `NODE_ENV`,所以用動態 import
 *   (`MONGODB_URI` 則是連線 factory 執行時才讀)。
 * - Mongoose 會真的連線,所以起一台 mongodb-memory-server 給它連(不碰任何真資料庫)。
 */
import { Test } from "@nestjs/testing";
import { MongoMemoryServer } from "mongodb-memory-server";

async function generateSchema(): Promise<void> {
  const mongo = await MongoMemoryServer.create();
  try {
    process.env.MONGODB_URI = mongo.getUri();
    process.env.JWT_SECRET = "schema-generation-only";
    process.env.NODE_ENV = "development";

    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    await app.close();
  } finally {
    // finally 不可省:失敗時(例如 ts-node 編譯不過)沒關掉 mongod,process.exitCode 也退不出去,
    // 本機與 CI 都會卡住直到逾時(接 CI 時踩到)
    await mongo.stop();
  }
}

// api 編譯成 CommonJS,沒有 top-level await 可用;結束碼的寫法與 db-migrator 的 seed 一致
generateSchema()
  .then(() => {
    process.stdout.write("schema.gql 已重生\n");
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`schema.gql 重生失敗:${message}\n`);
    process.exitCode = 1;
  });
