import { randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { hashSync, verify as verifyPassword } from "@node-rs/argon2";
import type { Types } from "mongoose";

import {
  RefreshTokensRepository,
  UsersRepository,
} from "../database/database.module";
import type { OperatorContext } from "../database/operator-context";
import { authError } from "./auth-error";
import { LoginThrottle } from "./login-throttle";
import {
  type MemberOrg,
  OperatorContextService,
} from "./operator-context.service";
import type { RequestUser } from "./request-context";
import { TokenService } from "./token.service";

/** 一次登入 / 換票的結果:access token 回 body,refresh token 由 resolver 寫入 cookie。 */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * 登入線自己的寫入(refresh_tokens 屬帳號、非租戶資料):以該使用者為操作者填 createdBy / updatedBy。
 * 可見範圍在此無作用(refresh_tokens 未掛 tenantScope)。
 */
function asAccount(userId: Types.ObjectId): OperatorContext {
  return {
    actorId: userId,
    currentOrgId: null,
    visibleOrgIds: "all",
    managedOrgIds: "all",
    // 這條路徑只碰帳號表,走不到資料範圍規則(ADR-0008);明寫空集合而非省略
    memberOrgIds: [],
    roleIds: [],
  };
}

/**
 * 帳號不存在時拿來「假驗證」的雜湊(每次啟動隨機產生,永遠驗不過)。
 * 目的:讓「帳號不存在」與「帳號存在但密碼錯」花一樣久 — argon2 刻意很慢(約百毫秒),
 * 若不存在的帳號直接回錯,攻擊者用回應時間就能分辨帳號是否存在(時間側信道枚舉帳號),
 * 即使錯誤訊息相同也一樣。詳見 ADR-0003「登入」。
 */
const DUMMY_PASSWORD_HASH = hashSync(randomBytes(32).toString("hex"));

/** 查使用者 / 定位 refresh token 用:兩張表都不受租戶過濾,兩個範圍在此無作用。 */
const LOOKUP: OperatorContext = {
  actorId: null,
  currentOrgId: null,
  visibleOrgIds: "all",
  managedOrgIds: "all",
  memberOrgIds: [],
  roleIds: [],
};

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly tokens: TokenService,
    private readonly throttle: LoginThrottle,
    private readonly operatorContexts: OperatorContextService,
  ) {}

  /**
   * 帳密登入(ADR-0003:登入識別 = account)。
   * 帳號不存在與密碼錯誤同回 INVALID_CREDENTIALS(不可枚舉帳號);停用帳號回 ACCOUNT_DISABLED。
   */
  async login(account: string, password: string): Promise<IssuedTokens> {
    if (this.throttle.isLocked(account)) {
      throw authError(
        "TOO_MANY_ATTEMPTS",
        "Too many failed login attempts; try again later",
      );
    }
    const user = await this.users.findOne(LOOKUP, { account });
    // 帳號不存在也跑一次 argon2(對假雜湊),與「存在但密碼錯」耗時相同 — 見 DUMMY_PASSWORD_HASH 說明
    const isPasswordValid = await verifyPassword(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );
    if (!user || !isPasswordValid) {
      this.throttle.recordFailure(account);
      throw authError("INVALID_CREDENTIALS", "Invalid account or password");
    }
    if (!user.enabled) {
      throw authError("ACCOUNT_DISABLED", "Account is disabled");
    }
    this.throttle.recordSuccess(account);
    return this.issueTokens(user._id, null);
  }

  /**
   * 以 refresh token 換新(每次使用即輪替:舊筆 revokedAt、發新筆)。
   * 已輪替的舊 token 再被使用視為外洩 → 作廢該帳號全部 refresh;逾期 → TOKEN_EXPIRED。
   */
  async refresh(rawToken: string | undefined): Promise<IssuedTokens> {
    const stored = rawToken ? await this.findStoredToken(rawToken) : null;
    if (stored?.accountType !== "user") {
      throw authError("UNAUTHENTICATED", "Invalid refresh token");
    }
    if (stored.revokedAt !== null) {
      // 重用已輪替的 token = 外洩訊號:這個帳號的所有 session 一律作廢
      await this.revokeAll(stored.accountId);
      throw authError("UNAUTHENTICATED", "Refresh token reuse detected");
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      throw authError("TOKEN_EXPIRED", "Refresh token expired");
    }
    await this.loadActiveUser(stored.accountId);
    await this.refreshTokens.updateById(
      asAccount(stored.accountId),
      stored._id,
      {
        $set: { revokedAt: new Date() },
      },
    );
    return this.issueTokens(stored.accountId, stored.currentOrgId);
  }

  /**
   * 作廢當前 refresh token(cookie 對應那一筆);不是自己的或不存在則不動。
   * 主動登出以軟刪除表示(ADR-0007)而非 revokedAt — revokedAt 專指「已被輪替」,
   * 兩者分開才能把「登出後舊 cookie 再送來」與「輪替後舊 token 被重放(外洩)」區別開來。
   */
  async logout(user: RequestUser, rawToken: string | undefined): Promise<void> {
    const stored = rawToken ? await this.findStoredToken(rawToken) : null;
    if (!stored?.accountId.equals(user._id)) {
      return;
    }
    await this.refreshTokens.softDeleteById(asAccount(user._id), stored._id);
  }

  /** 登出所有裝置:該帳號全部 refresh token 一律軟刪除(同 `logout` 的語意)。 */
  async logoutAllDevices(user: RequestUser): Promise<void> {
    await this.refreshTokens.updateMany(
      asAccount(user._id),
      { accountType: "user", accountId: user._id },
      { $set: { deletedAt: new Date() } },
    );
  }

  /**
   * 切換當前組織:驗 orgId ∈ 所屬組織後換發 access token(範圍外 → FORBIDDEN);
   * 同時把 cookie 對應的 refresh token 記下新組織,之後 refresh 換發時沿用。
   */
  async switchOrg(
    user: RequestUser,
    orgId: string,
    rawToken: string | undefined,
  ): Promise<string> {
    const { memberOrgs } = await this.operatorContexts.resolve(user._id, null);
    const target = memberOrgs.find((org) => String(org.id) === orgId);
    if (!target) {
      throw authError("FORBIDDEN", "Org is not one of the user's member orgs");
    }
    const stored = rawToken ? await this.findStoredToken(rawToken) : null;
    if (stored?.accountId.equals(user._id)) {
      await this.refreshTokens.updateById(asAccount(user._id), stored._id, {
        $set: { currentOrgId: target.id },
      });
    }
    return this.tokens.signAccessToken({
      userId: user._id,
      currentOrgId: target.id,
    });
  }

  /** 使用者的所屬組織清單(依加入時間)。 */
  async memberOrgsOf(userId: Types.ObjectId): Promise<MemberOrg[]> {
    const { memberOrgs } = await this.operatorContexts.resolve(userId, null);
    return memberOrgs;
  }

  /** 每請求現查使用者(v1 不快取,停用立即生效,ADR-0003);不存在或停用即拒。 */
  async loadActiveUser(userId: Types.ObjectId): Promise<RequestUser> {
    const user = await this.users.findById(LOOKUP, userId);
    if (!user) {
      throw authError("UNAUTHENTICATED", "User no longer exists");
    }
    if (!user.enabled) {
      throw authError("ACCOUNT_DISABLED", "Account is disabled");
    }
    return user;
  }

  private findStoredToken(rawToken: string) {
    return this.refreshTokens.findOne(LOOKUP, {
      tokenHash: this.tokens.hashRefreshToken(rawToken),
    });
  }

  private async revokeAll(userId: Types.ObjectId): Promise<void> {
    await this.refreshTokens.updateMany(
      asAccount(userId),
      { accountType: "user", accountId: userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }

  /**
   * 發一組登入 token(access + refresh)。公開給密碼流程用:設定新密碼(啟用 / 重設)成功後
   * 直接發登入 token,免再登入。呼叫端須已確認使用者存在且未停用。
   */
  async issueTokens(
    userId: Types.ObjectId,
    currentOrgId: Types.ObjectId | null,
  ): Promise<IssuedTokens> {
    const { operator } = await this.operatorContexts.resolve(
      userId,
      currentOrgId,
    );
    const accessToken = this.tokens.signAccessToken({
      userId,
      currentOrgId: operator.currentOrgId,
    });
    const refreshToken = this.tokens.generateRefreshToken();
    const refreshExpiresAt = this.tokens.refreshTokenExpiresAt();
    await this.refreshTokens.create(asAccount(userId), {
      accountId: userId,
      accountType: "user",
      tokenHash: this.tokens.hashRefreshToken(refreshToken),
      expiresAt: refreshExpiresAt,
      currentOrgId: operator.currentOrgId,
    });
    return { accessToken, refreshToken, refreshExpiresAt };
  }
}
