import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

/** `apps/print-agent` 的根目錄。 */
export const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * 把代理程式打成**單一 CommonJS 檔**(Node 24 的 SEA 主程式只吃 CommonJS、不能再 `require` 其他檔):
 * `@repo/domain` 依 tsconfig `paths` 直接吃原始碼,`pngjs` 一起包進來;Node 內建模組留著。
 * 版本以 `define` 烘進產物(`src/version.ts`)。
 */
export async function bundleAgent({
  version,
  outfile,
}: {
  version: string;
  outfile: string;
}): Promise<void> {
  await build({
    entryPoints: [path.join(appRoot, "src/main.ts")],
    tsconfig: path.join(appRoot, "tsconfig.json"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    outfile,
    define: { __PRINT_AGENT_VERSION__: JSON.stringify(version) },
    legalComments: "none",
    logLevel: "warning",
  });
}

/** 讀 `--name value` 形式的參數(打包腳本共用;pnpm 轉傳時多出的 `--` 略過)。 */
export function readOptions(
  argv: readonly string[],
  allowed: readonly string[],
): Map<string, string> {
  const args = argv.filter((value) => value !== "--");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index] ?? "";
    const value = args[index + 1];
    if (!allowed.includes(name)) {
      throw new Error(`不認得的參數:${name}(可用:${allowed.join(" ")})`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} 缺少值`);
    }
    values.set(name, value);
  }
  return values;
}
