import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  type Provider,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { type JwtPayload, decode, verify } from "jsonwebtoken";

/** 注入 token(Cloud Scheduler 呼叫身分的設定,自環境變數讀取;登記:docs/env-registry.md)。 */
export const SCHEDULER_IDENTITY_CONFIG = Symbol("SCHEDULER_IDENTITY_CONFIG");

export interface SchedulerIdentityConfig {
  /**
   * 唯一接受的呼叫身分:Cloud Scheduler 工作所用 service account 的 email(`SCHEDULER_INVOKER_EMAIL`)。
   * 未設 → 內部端點拒絕所有呼叫(403),本地與未設定排程的環境即此狀態。
   */
  invokerEmail: string | undefined;
  /** OIDC token 的 audience(`SCHEDULER_AUDIENCE`,建 Scheduler 工作時 `--oidc-token-audience` 給的值)。未設同上。 */
  audience: string | undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

export function loadSchedulerIdentityConfig(
  config: ConfigService,
): SchedulerIdentityConfig {
  return {
    invokerEmail: nonEmpty(config.get<string>("SCHEDULER_INVOKER_EMAIL")),
    audience: nonEmpty(config.get<string>("SCHEDULER_AUDIENCE")),
  };
}

export const schedulerIdentityConfigProvider: Provider = {
  provide: SCHEDULER_IDENTITY_CONFIG,
  inject: [ConfigService],
  useFactory: loadSchedulerIdentityConfig,
};

/** Google 簽 OIDC ID token 的公鑰(PEM,依 `kid` 分)。 */
export const GOOGLE_OIDC_CERTS_URL =
  "https://www.googleapis.com/oauth2/v1/certs";
const GOOGLE_ISSUERS: [string, string] = [
  "https://accounts.google.com",
  "accounts.google.com",
];
/** 回應沒帶 `max-age` 時的公鑰快取時間。 */
const DEFAULT_CERTS_TTL_MS = 60 * 60 * 1000;
/** 遇到沒見過的 `kid` 時重抓公鑰的最短間隔(不讓亂填 kid 的請求每次都打到 Google)。 */
const MIN_REFETCH_INTERVAL_MS = 60 * 1000;

/** 驗證結果:`unauthenticated` → 401(沒有或無效的 token)、`forbidden` → 403(token 有效但不是排程身分,或未設定)。 */
export type SchedulerIdentityResult = "ok" | "unauthenticated" | "forbidden";

interface CachedCerts {
  certs: Record<string, string>;
  fetchedAt: number;
  expiresAt: number;
}

function maxAgeMsOf(cacheControl: string | null): number {
  const match = /max-age=(\d+)/.exec(cacheControl ?? "");
  return match ? Number(match[1]) * 1000 : DEFAULT_CERTS_TTL_MS;
}

/**
 * 驗 Cloud Scheduler 帶來的 Google OIDC ID token:RS256 簽章對得上 Google 公鑰、issuer 是 Google、
 * audience 是 `SCHEDULER_AUDIENCE`、未過期,且 `email` 是 `SCHEDULER_INVOKER_EMAIL`(`email_verified`)。
 * 公鑰依回應的 `Cache-Control: max-age` 快取。
 */
@Injectable()
export class SchedulerIdentityVerifier {
  private cached: CachedCerts | undefined;

  constructor(
    @Inject(SCHEDULER_IDENTITY_CONFIG)
    private readonly config: SchedulerIdentityConfig,
  ) {}

  async verify(token: string): Promise<SchedulerIdentityResult> {
    const { invokerEmail, audience } = this.config;
    if (invokerEmail === undefined || audience === undefined) {
      return "forbidden";
    }
    const decoded = decode(token, { complete: true });
    const kid = decoded?.header.kid;
    if (decoded === null || kid === undefined) {
      return "unauthenticated";
    }
    const cert = await this.certFor(kid);
    if (cert === undefined) {
      return "unauthenticated";
    }
    let payload: string | JwtPayload;
    try {
      payload = verify(token, cert, {
        algorithms: ["RS256"],
        audience,
        issuer: GOOGLE_ISSUERS,
      });
    } catch {
      return "unauthenticated";
    }
    if (typeof payload === "string") {
      return "unauthenticated";
    }
    const isInvoker =
      payload.email === invokerEmail && payload.email_verified === true;
    return isInvoker ? "ok" : "forbidden";
  }

  private async certFor(kid: string): Promise<string | undefined> {
    const now = Date.now();
    const cached = this.cached;
    const isFresh = cached !== undefined && cached.expiresAt > now;
    if (isFresh && kid in cached.certs) {
      return cached.certs[kid];
    }
    // 過期 → 重抓;沒見過的 kid(Google 換鑰)→ 限速重抓
    if (!isFresh || now - cached.fetchedAt >= MIN_REFETCH_INTERVAL_MS) {
      this.cached = await fetchGoogleCerts(now);
    }
    return this.cached?.certs[kid];
  }
}

async function fetchGoogleCerts(now: number): Promise<CachedCerts> {
  const response = await fetch(GOOGLE_OIDC_CERTS_URL);
  if (!response.ok) {
    throw new Error(`取 Google OIDC 公鑰失敗:HTTP ${String(response.status)}`);
  }
  const certs = (await response.json()) as Record<string, string>;
  return {
    certs,
    fetchedAt: now,
    expiresAt: now + maxAgeMsOf(response.headers.get("cache-control")),
  };
}

const BEARER_PREFIX = /^Bearer\s+/i;

/**
 * 內部排程端點的守門:只放行 Cloud Scheduler 的 service account。
 * 端點另標 `@Public()` 跳過全域登入守門(那是後台使用者的 access token,與這裡無關)。
 */
@Injectable()
export class SchedulerAuthGuard implements CanActivate {
  private readonly logger = new Logger(SchedulerAuthGuard.name);

  constructor(private readonly verifier: SchedulerIdentityVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? "";
    const token = BEARER_PREFIX.test(header)
      ? header.replace(BEARER_PREFIX, "").trim()
      : "";
    if (!token) {
      throw new UnauthorizedException("Missing scheduler OIDC token");
    }
    const result = await this.verifier.verify(token);
    if (result === "unauthenticated") {
      this.logger.warn("排程端點收到無效的 OIDC token");
      throw new UnauthorizedException("Invalid scheduler OIDC token");
    }
    if (result === "forbidden") {
      this.logger.warn("排程端點收到非排程身分的呼叫(或呼叫身分未設定)");
      throw new ForbiddenException("Caller is not the scheduler");
    }
    return true;
  }
}
