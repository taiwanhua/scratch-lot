import { Args, Context, Mutation, Query, Resolver } from "@nestjs/graphql";

import type { OperatorContext } from "../database/operator-context";
import { AuthService, type IssuedTokens } from "./auth.service";
import {
  AllowMustChangePassword,
  CurrentOperator,
  CurrentUser,
  Public,
} from "./decorators";
import { LoginInput } from "./dto/login.input";
import { SwitchOrgInput } from "./dto/switch-org.input";
import {
  LoginPayload,
  LogoutAllDevicesPayload,
  LogoutPayload,
  RefreshPayload,
  SwitchOrgPayload,
} from "./models/auth-payloads.model";
import { Me, MeOrg } from "./models/me.model";
import { RefreshCookie } from "./refresh-cookie";
import type { GraphqlContext, RequestUser } from "./request-context";

/**
 * 登入線的 GraphQL 端點(形式 GQL-02、錯誤 GQL-04)。
 * `refresh` / `logout` / `logoutAllDevices` 沒有輸入 — 身分來自 access token 與 refresh cookie,不做空 input。
 */
@Resolver()
export class AuthResolver {
  constructor(
    private readonly auth: AuthService,
    private readonly refreshCookie: RefreshCookie,
  ) {}

  @Public()
  @Mutation(() => LoginPayload)
  async login(
    @Args("input") input: LoginInput,
    @Context() { res }: GraphqlContext,
  ): Promise<LoginPayload> {
    const issued = await this.auth.login(input.account, input.password);
    return this.issue(res, issued);
  }

  /** 公開:access token 過期時前端靠 cookie 換票,此時沒有可用的 access token。 */
  @Public()
  @Mutation(() => RefreshPayload)
  async refresh(
    @Context() { req, res }: GraphqlContext,
  ): Promise<RefreshPayload> {
    const issued = await this.auth.refresh(this.refreshCookie.read(req));
    return this.issue(res, issued);
  }

  @AllowMustChangePassword()
  @Mutation(() => LogoutPayload)
  async logout(
    @CurrentUser() user: RequestUser,
    @Context() { req, res }: GraphqlContext,
  ): Promise<LogoutPayload> {
    await this.auth.logout(user, this.refreshCookie.read(req));
    this.refreshCookie.clear(res);
    return { success: true };
  }

  @AllowMustChangePassword()
  @Mutation(() => LogoutAllDevicesPayload)
  async logoutAllDevices(
    @CurrentUser() user: RequestUser,
    @Context() { res }: GraphqlContext,
  ): Promise<LogoutAllDevicesPayload> {
    await this.auth.logoutAllDevices(user);
    this.refreshCookie.clear(res);
    return { success: true };
  }

  @Mutation(() => SwitchOrgPayload)
  async switchOrg(
    @Args("input") input: SwitchOrgInput,
    @CurrentUser() user: RequestUser,
    @Context() { req }: GraphqlContext,
  ): Promise<SwitchOrgPayload> {
    const accessToken = await this.auth.switchOrg(
      user,
      input.orgId,
      this.refreshCookie.read(req),
    );
    return { accessToken };
  }

  @AllowMustChangePassword()
  @Query(() => Me)
  async me(
    @CurrentUser() user: RequestUser,
    @CurrentOperator() operator: OperatorContext,
  ): Promise<Me> {
    const memberOrgs = await this.auth.memberOrgsOf(user._id);
    const orgs: MeOrg[] = memberOrgs.map((org) => ({
      id: String(org.id),
      name: org.name,
      // 不對外;`logoUrl` field resolver 據此現簽讀取網址(ADR-0010)
      logoPath: org.logoPath,
    }));
    const currentOrg =
      orgs.find((org) => org.id === String(operator.currentOrgId)) ?? null;
    return {
      id: String(user._id),
      account: user.account,
      name: user.name,
      email: user.email,
      nickname: user.nickname,
      gender: user.gender,
      phone: user.phone,
      address: user.address,
      mustChangePassword: user.settings.mustChangePassword === true,
      currentOrg,
      orgs,
    };
  }

  private issue(
    res: GraphqlContext["res"],
    issued: IssuedTokens,
  ): { accessToken: string } {
    this.refreshCookie.write(res, issued.refreshToken, issued.refreshExpiresAt);
    return { accessToken: issued.accessToken };
  }
}
