/**
 * `pnpm --filter @repo/print-agent build [--version x.y.z]`:打包成 `dist/print-agent.cjs`
 * (`node dist/print-agent.cjs version` 可直接執行;發布用的單一執行檔見 `package-sea.ts`)。
 */
import path from "node:path";

import { appRoot, bundleAgent, readOptions } from "./lib/bundle";

const options = readOptions(process.argv.slice(2), ["--version"]);
const outfile = path.join(appRoot, "dist/print-agent.cjs");
await bundleAgent({ version: options.get("--version") ?? "0.0.0", outfile });
process.stdout.write(`已輸出 ${outfile}\n`);
