import { Args, Context, Mutation, Resolver } from "@nestjs/graphql";

import { AllowMustChangePassword, CurrentUser, Public } from "../decorators";
import { RefreshCookie } from "../refresh-cookie";
import type { GraphqlContext, RequestUser } from "../request-context";
import { ChangePasswordInput } from "./dto/change-password.input";
import { RequestPasswordResetInput } from "./dto/request-password-reset.input";
import { SetPasswordInput } from "./dto/set-password.input";
import {
  ChangePasswordPayload,
  RequestPasswordResetPayload,
  SetPasswordPayload,
} from "./models/password-payloads.model";
import { PasswordService } from "./password.service";

/** 密碼流程的 GraphQL 端點(形式 GQL-02、錯誤 GQL-04)。 */
@Resolver()
export class PasswordResolver {
  constructor(
    private readonly passwords: PasswordService,
    private readonly refreshCookie: RefreshCookie,
  ) {}

  /** 公開:忘記密碼的人沒有登入狀態。 */
  @Public()
  @Mutation(() => RequestPasswordResetPayload)
  async requestPasswordReset(
    @Args("input") input: RequestPasswordResetInput,
  ): Promise<RequestPasswordResetPayload> {
    await this.passwords.requestPasswordReset(input.email);
    return { success: true };
  }

  /** 公開:憑信件 token 設定密碼,成功即登入(與 login 相同的 token 發放方式)。 */
  @Public()
  @Mutation(() => SetPasswordPayload)
  async setPassword(
    @Args("input") input: SetPasswordInput,
    @Context() { res }: GraphqlContext,
  ): Promise<SetPasswordPayload> {
    const issued = await this.passwords.setPassword(
      input.token,
      input.newPassword,
    );
    this.refreshCookie.write(res, issued.refreshToken, issued.refreshExpiresAt);
    return { accessToken: issued.accessToken };
  }

  /** 首登須改密碼者唯一能做的寫入操作。 */
  @AllowMustChangePassword()
  @Mutation(() => ChangePasswordPayload)
  async changePassword(
    @Args("input") input: ChangePasswordInput,
    @CurrentUser() user: RequestUser,
  ): Promise<ChangePasswordPayload> {
    await this.passwords.changePassword(
      user,
      input.currentPassword,
      input.newPassword,
    );
    return { success: true };
  }
}
