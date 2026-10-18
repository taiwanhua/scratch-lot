import { ConfigService } from "@nestjs/config";

import { parseDurationMs } from "../duration";

/** 注入 token(密碼流程的設定值,自環境變數讀取;登記:docs/env-registry.md)。 */
export const PASSWORD_CONFIG = Symbol("PASSWORD_CONFIG");

export interface PasswordConfig {
  /** 信件連結的後台網址(`ADMIN_APP_URL`;連結 = `<ADMIN_APP_URL>/set-password?token=…`),不含結尾斜線。 */
  adminAppUrl: string;
  /** 啟用連結效期(`ACTIVATION_TOKEN_TTL`,預設 7d;ADR-0009)。 */
  activationTokenTtlMs: number;
  /** 重設密碼連結效期(`PASSWORD_RESET_TOKEN_TTL`,預設 30m;ADR-0009)。 */
  passwordResetTokenTtlMs: number;
}

/** 本地 admin 的 dev server(apps/admin `vite --port 3001`)。 */
export const DEFAULT_ADMIN_APP_URL = "http://localhost:3001";
export const DEFAULT_ACTIVATION_TOKEN_TTL = "7d";
export const DEFAULT_PASSWORD_RESET_TOKEN_TTL = "30m";

/** 每個變數都有內建預設值,不設也能跑。 */
export function loadPasswordConfig(config: ConfigService): PasswordConfig {
  return {
    adminAppUrl: withoutTrailingSlash(
      nonEmpty(config.get<string>("ADMIN_APP_URL")) ?? DEFAULT_ADMIN_APP_URL,
    ),
    activationTokenTtlMs: parseDurationMs(
      config.get<string>("ACTIVATION_TOKEN_TTL") ??
        DEFAULT_ACTIVATION_TOKEN_TTL,
      "ACTIVATION_TOKEN_TTL",
    ),
    passwordResetTokenTtlMs: parseDurationMs(
      config.get<string>("PASSWORD_RESET_TOKEN_TTL") ??
        DEFAULT_PASSWORD_RESET_TOKEN_TTL,
      "PASSWORD_RESET_TOKEN_TTL",
    ),
  };
}

/** 空字串視同未設定(YAML 留空鍵時常見)。 */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

function withoutTrailingSlash(url: string): string {
  let trimmed = url.trim();
  while (trimmed.endsWith("/")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

export const passwordConfigProvider = {
  provide: PASSWORD_CONFIG,
  inject: [ConfigService],
  useFactory: loadPasswordConfig,
};
