import { PrintAgent } from "../agent/agent";
import { PrintAgentApiClient } from "../api-client/api-client";
import { AgentConfigError, readAgentConfig } from "../config/config-file";
import { resolvePaths } from "../config/paths";
import { TcpPrinterTransport } from "../escpos/tcp-printer";
import type { PrinterTransport } from "../escpos/transport";
import { DailyFileLogger } from "../logging/logger";
import { PairingError, pairAgent } from "../pairing/pairing";
import { SimulatorTransport } from "../simulator/simulator";
import { AGENT_VERSION } from "../version";

/**
 * 指令列(安裝程式與服務共用同一個執行檔;輸出走 `process.stdout.write`,STRUCT-06):
 *
 * ```
 * print-agent run  [--config-dir <目錄>] [--log-dir <目錄>] [--simulator <目錄>]
 * print-agent pair --server <伺服器網址> --code <配對碼> [--config-dir <目錄>] [--force]
 * print-agent version
 * ```
 *
 * 結束碼:0 成功;1 執行錯誤;2 參數錯誤;3 已配對過(沒加 --force,保留現有金鑰)。
 */
export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  alreadyPaired: 3,
} as const;

const USAGE = `用法:
  print-agent run  [--config-dir <目錄>] [--log-dir <目錄>] [--simulator <目錄>]
  print-agent pair --server <伺服器網址> --code <配對碼> [--config-dir <目錄>] [--force]
  print-agent version
`;

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export const processIo: CliIo = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

const VALUE_FLAGS = new Set([
  "--config-dir",
  "--log-dir",
  "--simulator",
  "--server",
  "--code",
]);
const BOOLEAN_FLAGS = new Set(["--force"]);

export interface ParsedArgs {
  command: string | undefined;
  values: Map<string, string>;
  flags: Set<string>;
}

export class UsageError extends Error {
  override readonly name = "UsageError";
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  // pnpm script 轉傳時可能多一個 `--`
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  const command = args.shift();
  while (args.length > 0) {
    const name = args.shift() ?? "";
    if (BOOLEAN_FLAGS.has(name)) {
      flags.add(name);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      throw new UsageError(`不認得的參數:${name}`);
    }
    const value = args.shift();
    if (value === undefined || value.startsWith("--")) {
      throw new UsageError(`${name} 缺少值`);
    }
    values.set(name, value);
  }
  return { command, values, flags };
}

function pathsOf(args: ParsedArgs) {
  return resolvePaths({
    configDir: args.values.get("--config-dir"),
    logDir: args.values.get("--log-dir"),
  });
}

async function pairCommand(args: ParsedArgs, io: CliIo): Promise<number> {
  const server = args.values.get("--server");
  const code = args.values.get("--code");
  if (server === undefined || code === undefined) {
    throw new UsageError("pair 需要 --server 與 --code");
  }
  const paths = pathsOf(args);
  try {
    const config = await pairAgent({
      serverUrl: server,
      code,
      configFile: paths.configFile,
      version: AGENT_VERSION,
      force: args.flags.has("--force"),
    });
    io.out(`配對成功:${config.name}(設定檔 ${paths.configFile})\n`);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof PairingError) {
      io.err(`${error.message}\n`);
      return error.reason === "already-paired"
        ? EXIT.alreadyPaired
        : EXIT.error;
    }
    throw error;
  }
}

/** 跑服務:直到收到 SIGINT / SIGTERM(服務停止)才結束。 */
async function runCommand(args: ParsedArgs, io: CliIo): Promise<number> {
  const paths = pathsOf(args);
  let config;
  try {
    config = await readAgentConfig(paths.configFile);
  } catch (error) {
    if (error instanceof AgentConfigError) {
      io.err(`${error.message}\n`);
      return EXIT.error;
    }
    throw error;
  }
  if (config === null) {
    io.err(`尚未配對:先執行 print-agent pair(設定檔 ${paths.configFile})\n`);
    return EXIT.error;
  }
  const logger = new DailyFileLogger({
    dir: paths.logDir,
    echo: (line) => process.stdout.write(line),
  });
  const simulatorDir = args.values.get("--simulator");
  const transport: PrinterTransport =
    simulatorDir === undefined
      ? new TcpPrinterTransport()
      : new SimulatorTransport({ dir: simulatorDir });
  if (simulatorDir !== undefined) {
    logger.info("模擬印表機模式:不送出,存成圖片", { dir: simulatorDir });
  }
  const agent = new PrintAgent({
    api: new PrintAgentApiClient({
      serverUrl: config.serverUrl,
      key: config.key,
    }),
    transport,
    logger,
    version: AGENT_VERSION,
  });
  await agent.start();
  logger.info("已連到伺服器", { server: config.serverUrl, agent: config.name });
  await new Promise<void>((resolve) => {
    const onStop = () => {
      process.off("SIGINT", onStop);
      process.off("SIGTERM", onStop);
      resolve();
    };
    process.on("SIGINT", onStop);
    process.on("SIGTERM", onStop);
  });
  await agent.stop();
  return EXIT.ok;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = processIo,
): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    io.err(`${(error as Error).message}\n${USAGE}`);
    return EXIT.usage;
  }
  try {
    switch (args.command) {
      case "version":
      case "--version": {
        io.out(`${AGENT_VERSION}\n`);
        return EXIT.ok;
      }
      case "pair": {
        return await pairCommand(args, io);
      }
      case "run": {
        return await runCommand(args, io);
      }
      default: {
        io.err(USAGE);
        return EXIT.usage;
      }
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message}\n${USAGE}`);
      return EXIT.usage;
    }
    io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.error;
  }
}
