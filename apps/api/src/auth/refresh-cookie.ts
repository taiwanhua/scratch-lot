import { Inject, Injectable } from "@nestjs/common";
import type { Request, Response } from "express";

import { AUTH_CONFIG, type AuthConfig } from "./auth.config";

export const REFRESH_COOKIE_NAME = "refresh_token";

/** GraphQL 單一端點,cookie Path 只能限到 `/graphql`(既定決策);靠 SameSite=Lax + Secure。 */
const COOKIE_PATH = "/graphql";

/** 從 Cookie 標頭取出指定名稱的值(token 為 base64url,無需解碼;仍容錯 URL 編碼)。 */
export function readCookieValue(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) {
    return undefined;
  }
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() !== name) {
      continue;
    }
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/** refresh token 的 cookie 讀寫(httpOnly、Secure、SameSite=Lax、Domain 由 COOKIE_DOMAIN 控制)。 */
@Injectable()
export class RefreshCookie {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  read(req: Request): string | undefined {
    return readCookieValue(req.headers.cookie, REFRESH_COOKIE_NAME);
  }

  write(res: Response, token: string, expiresAt: Date): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: COOKIE_PATH,
      domain: this.config.cookieDomain,
      expires: expiresAt,
    });
  }

  clear(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: COOKIE_PATH,
      domain: this.config.cookieDomain,
    });
  }
}
