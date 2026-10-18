import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import type { Request } from "express";

import { PrintAgentsService } from "./print-agents.service";
import type { AgentRecord } from "./printing-mapper";

const BEARER_PREFIX = /^Bearer\s+/i;

/** 驗過金鑰的請求:代理程式掛在 request 上。 */
interface PrintAgentRequest extends Request {
  printAgent?: AgentRecord;
}

/**
 * 代理程式的 HTTP 端點守門:`Authorization: Bearer <代理程式金鑰>`。
 * 每個請求都以金鑰雜湊查啟用中的代理程式 —— 重新配對 / 停用清掉雜湊後**立即**一律 401;
 * 查到即記一次 `lastSeenAt`(輪詢、心跳都算「看到」)。
 * 端點標 `@Public()` 跳過後台的登入守門(呼叫者不是後台使用者),改由本守門把關。
 */
@Injectable()
export class PrintAgentAuthGuard implements CanActivate {
  constructor(private readonly agents: PrintAgentsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PrintAgentRequest>();
    const header = request.headers.authorization ?? "";
    const key = BEARER_PREFIX.test(header)
      ? header.replace(BEARER_PREFIX, "").trim()
      : "";
    if (key === "") {
      throw new UnauthorizedException("Missing print agent key");
    }
    const agent = await this.agents.authenticate(key);
    if (agent === null) {
      throw new UnauthorizedException("Invalid or revoked print agent key");
    }
    request.printAgent = agent;
    return true;
  }
}

/** 守門驗過的代理程式。 */
export const CurrentPrintAgent = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AgentRecord => {
    const { printAgent } = context
      .switchToHttp()
      .getRequest<PrintAgentRequest>();
    if (printAgent === undefined) {
      throw new Error(
        "CurrentPrintAgent 只能用在 PrintAgentAuthGuard 保護的端點",
      );
    }
    return printAgent;
  },
);
