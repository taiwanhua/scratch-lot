/**
 * `onboard` 指令入口(`pnpm --filter @repo/db-migrator onboard …`;用法見 `command.ts`)。
 * 以 tsx 直跑;密碼在終端機輸入(不回顯)。
 */
import { runOnboardEntry } from "./command";

await runOnboardEntry(process.argv.slice(2));
