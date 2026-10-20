/**
 * demo 指令入口(`pnpm --filter @repo/db-migrator demo …`;用法與流程見 `command.ts`)。
 *
 * 以 tsx 直跑。三個環境(含 production)都要 `--environment`、`DEMO_ALLOW_ENV` 允許清單與完整的
 * `--confirm=demo:<environment>:<資料庫名>:<mode>`;缺任何一項或任何一段不符即 exit 1,一筆都不寫。
 */
import { DEFAULT_REGISTRY_PATH } from "../cli";
import {
  loadRegisteredDemoSource,
  loadRegisteredManagedFormKeys,
  runDemoEntry,
} from "./command";

await runDemoEntry(process.argv.slice(2), {
  loadDemoSource: () => loadRegisteredDemoSource(DEFAULT_REGISTRY_PATH),
  loadManagedFormKeys: () =>
    loadRegisteredManagedFormKeys(DEFAULT_REGISTRY_PATH),
});
