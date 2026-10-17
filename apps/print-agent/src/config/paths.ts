import path from "node:path";

/**
 * 設定檔與 log 的位置(底座規格第 6 章「代理程式」):三個平台固定位置,安裝程式與服務共用。
 * 設定檔內含代理程式金鑰,目錄只給服務身分(與安裝時的系統管理員)存取:
 *
 * | 平台    | 設定檔目錄                                   | log 目錄                          | 服務身分                 |
 * | ------- | -------------------------------------------- | --------------------------------- | ------------------------ |
 * | Windows | `C:\ProgramData\print-agent\`                | `C:\ProgramData\print-agent\logs\` | LocalSystem(WinSW 預設) |
 * | Linux   | `/etc/print-agent/`                          | `/var/log/print-agent/`           | 系統使用者 `print-agent` |
 * | macOS   | `/Library/Application Support/print-agent/`  | `/Library/Logs/print-agent/`      | root(launchd daemon)   |
 *
 * 開發與測試以 `--config-dir` / `--log-dir` 指到別處。
 */
export interface AgentPaths {
  configDir: string;
  configFile: string;
  logDir: string;
}

export const CONFIG_FILE_NAME = "config.json";

export function defaultPaths(
  platform: NodeJS.Platform = process.platform,
): AgentPaths {
  switch (platform) {
    case "win32": {
      const configDir = String.raw`C:\ProgramData\print-agent`;
      return {
        configDir,
        configFile: path.win32.join(configDir, CONFIG_FILE_NAME),
        logDir: path.win32.join(configDir, "logs"),
      };
    }
    case "darwin": {
      const configDir = "/Library/Application Support/print-agent";
      return {
        configDir,
        configFile: path.posix.join(configDir, CONFIG_FILE_NAME),
        logDir: "/Library/Logs/print-agent",
      };
    }
    default: {
      const configDir = "/etc/print-agent";
      return {
        configDir,
        configFile: path.posix.join(configDir, CONFIG_FILE_NAME),
        logDir: "/var/log/print-agent",
      };
    }
  }
}

/** 指令列覆寫(開發、測試):只給 `configDir` 時 log 放它底下的 `logs/`。 */
export function resolvePaths(
  overrides: { configDir?: string; logDir?: string },
  platform: NodeJS.Platform = process.platform,
): AgentPaths {
  const defaults = defaultPaths(platform);
  if (overrides.configDir === undefined) {
    return { ...defaults, logDir: overrides.logDir ?? defaults.logDir };
  }
  const configDir = path.resolve(overrides.configDir);
  return {
    configDir,
    configFile: path.join(configDir, CONFIG_FILE_NAME),
    logDir: path.resolve(overrides.logDir ?? path.join(configDir, "logs")),
  };
}
