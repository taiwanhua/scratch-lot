import { normalizePairingCode } from "@repo/domain/printing";

import {
  type FetchLike,
  PrintAgentApiError,
  pairWithServer,
} from "../api-client/api-client";
import {
  type AgentConfig,
  normalizeServerUrl,
  readAgentConfig,
  writeAgentConfig,
} from "../config/config-file";

/**
 * 配對:伺服器網址 + 8 碼配對碼 → 換長期代理程式金鑰 → 寫入本機設定檔。
 * 執行檔不寫死環境:連哪個環境由伺服器網址決定。已有設定檔時預設不覆蓋(更新版本時保留金鑰)。
 */
export type PairingFailure =
  | "invalid-server-url"
  | "invalid-code"
  | "already-paired"
  | "rejected"
  | "unreachable";

export class PairingError extends Error {
  override readonly name = "PairingError";

  constructor(
    readonly reason: PairingFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface PairOptions {
  serverUrl: string;
  code: string;
  configFile: string;
  version: string;
  /** 已有設定檔時仍重新配對(舊金鑰在後台按 [重新配對] 時已失效)。 */
  force?: boolean;
  fetch?: FetchLike;
  now?: () => Date;
}

export async function pairAgent(options: PairOptions): Promise<AgentConfig> {
  const serverUrl = normalizeServerUrl(options.serverUrl);
  if (serverUrl === null) {
    throw new PairingError(
      "invalid-server-url",
      "伺服器網址不正確(請從印表機管理頁複製,須為 https://)",
    );
  }
  const code = normalizePairingCode(options.code);
  if (code === null) {
    throw new PairingError("invalid-code", "配對碼格式不正確(8 碼英數)");
  }
  if (options.force !== true) {
    const existing = await readAgentConfig(options.configFile);
    if (existing !== null) {
      throw new PairingError(
        "already-paired",
        `已配對過(${existing.name}),保留現有金鑰;要重新配對請加 --force`,
      );
    }
  }
  let paired;
  try {
    paired = await pairWithServer(
      { serverUrl, fetch: options.fetch },
      { code, version: options.version },
    );
  } catch (error) {
    if (error instanceof PrintAgentApiError && error.unauthorized) {
      throw new PairingError(
        "rejected",
        "配對碼不對、已過期或已使用過:請在印表機管理頁重新產生",
      );
    }
    throw new PairingError(
      "unreachable",
      `連不上伺服器:${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const config: AgentConfig = {
    serverUrl,
    agentId: paired.agentId,
    key: paired.key,
    name: paired.name,
    pairedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  await writeAgentConfig(options.configFile, config);
  return config;
}
