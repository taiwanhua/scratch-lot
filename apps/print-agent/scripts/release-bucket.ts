/**
 * 發布 workflow 讀發布目標 bucket:`deploy/env/<環境>.yaml` 的 `GCS_BUCKET_PRIVATE`(api 讀 manifest 的同一個)。
 *
 *   pnpm --filter @repo/print-agent exec tsx scripts/release-bucket.ts --environment dev
 *
 * stdout 只有 bucket 名稱一行;沒設定時失敗(該環境沒有私有 bucket,api 也讀不到安裝檔)。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { privateBucketOf } from "../src/release/release";
import { appRoot, readOptions } from "./lib/bundle";

const ENVIRONMENTS = new Set(["dev", "staging", "production"]);

const options = readOptions(process.argv.slice(2), ["--environment"]);
const environment = options.get("--environment") ?? "";
if (!ENVIRONMENTS.has(environment)) {
  throw new Error("--environment 必須是 dev / staging / production");
}
const file = path.join(appRoot, "../../deploy/env", `${environment}.yaml`);
const bucket = privateBucketOf(readFileSync(file, "utf8"));
if (bucket === null) {
  throw new Error(`deploy/env/${environment}.yaml 沒有設定 GCS_BUCKET_PRIVATE`);
}
process.stdout.write(`${bucket}\n`);
