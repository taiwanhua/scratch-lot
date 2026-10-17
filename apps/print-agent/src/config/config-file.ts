import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 本機設定檔(`config.json`):配對後寫入,服務啟動時讀取。內含長期代理程式金鑰,
 * POSIX 上目錄 0700、檔案 0600;Windows 的存取權由安裝程式(`安裝.bat`)以 icacls 收斂。
 * 更新版本時安裝程式偵測到它就保留(不必重新配對)。
 */
export interface AgentConfig {
  /** 伺服器網址(API 的 origin,不含結尾斜線)。 */
  serverUrl: string;
  agentId: string;
  /** 長期代理程式金鑰(只在這裡,不寫 log)。 */
  key: string;
  /** 配對時後台填的名稱(log 與安裝訊息用)。 */
  name: string;
  /** 配對時間(ISO 8601)。 */
  pairedAt: string;
}

export class AgentConfigError extends Error {
  override readonly name = "AgentConfigError";
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * 伺服器網址正規化:只接受 `https://`(本機開發的 localhost 才允許 `http://`),
 * 只取 origin(後台顯示的網址就是 API origin;多貼的路徑、結尾斜線一律去掉)。不合法回 null。
 */
export function normalizeServerUrl(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const secure = url.protocol === "https:";
  const localHttp =
    url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (!secure && !localHttp) {
    return null;
  }
  if (url.username !== "" || url.password !== "") {
    return null;
  }
  return url.origin;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** 驗證讀到的內容;缺欄位視為壞檔(不自行補值)。 */
export function parseAgentConfig(value: unknown): AgentConfig | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const serverUrl = normalizeServerUrl(record.serverUrl);
  if (
    serverUrl === null ||
    !isNonEmptyString(record.agentId) ||
    !isNonEmptyString(record.key) ||
    typeof record.name !== "string" ||
    !isNonEmptyString(record.pairedAt)
  ) {
    return null;
  }
  return {
    serverUrl,
    agentId: record.agentId,
    key: record.key,
    name: record.name,
    pairedAt: record.pairedAt,
  };
}

/** 讀設定檔:不存在回 null;存在但壞掉丟 `AgentConfigError`(不要當成沒配對而覆蓋掉)。 */
export async function readAgentConfig(
  file: string,
): Promise<AgentConfig | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AgentConfigError(`設定檔不是合法的 JSON:${file}`);
  }
  const config = parseAgentConfig(value);
  if (config === null) {
    throw new AgentConfigError(`設定檔缺少必要欄位:${file}`);
  }
  return config;
}

/** 寫設定檔:先寫暫存檔再改名(寫到一半斷電不會留下半個檔)。 */
export async function writeAgentConfig(
  file: string,
  config: AgentConfig,
): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, file);
  if (process.platform !== "win32") {
    await chmod(file, 0o600);
  }
}
