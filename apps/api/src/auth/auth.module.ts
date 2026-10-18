import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { DatabaseModule } from "../database/database.module";
import { MailModule } from "../mail/mail.module";
import { authConfigProvider } from "./auth.config";
import { AuthGuard } from "./auth.guard";
import { AuthResolver } from "./auth.resolver";
import { AuthService } from "./auth.service";
import { LoginThrottle } from "./login-throttle";
import { OperatorContextService } from "./operator-context.service";
import { ActionTokenService } from "./password/action-token.service";
import { passwordConfigProvider } from "./password/password.config";
import { PasswordResolver } from "./password/password.resolver";
import { PasswordService } from "./password/password.service";
import { RefreshCookie } from "./refresh-cookie";
import { TokenService } from "./token.service";

/**
 * 登入線:登入 / token 生命週期 / 全域登入守門與操作者上下文,
 * 以及密碼流程 — 忘記密碼 / 設定新密碼(啟用信、重設信共用)/ 改密碼(`password/`)。
 */
@Module({
  imports: [DatabaseModule, MailModule],
  providers: [
    authConfigProvider,
    passwordConfigProvider,
    TokenService,
    LoginThrottle,
    RefreshCookie,
    OperatorContextService,
    AuthService,
    AuthResolver,
    ActionTokenService,
    PasswordService,
    PasswordResolver,
    // 全域 guard:未標 @Public() 的 resolver 一律要求已登入
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  // PasswordService 對外:第 3 段(開通租戶、新增使用者)呼叫 sendActivationEmail
  exports: [AuthService, OperatorContextService, PasswordService],
})
export class AuthModule {}
