import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Types } from "mongoose";

import {
  PRINT_AGENT_REPORTABLE_ERRORS,
  PRINT_JOB_RESULTS,
  type PrintAgentClaimResponse,
  type PrintAgentJob,
  type PrintAgentJobsResponse,
  type PrintAgentPairResponse,
  type PrintAgentPrinter,
  type PrintAgentReportableError,
  type PrintAgentTicketResponse,
  type PrintJobResult,
} from "@repo/domain/printing";

import { Public } from "../auth/decorators";
import { RealtimeTicketService } from "../realtime/realtime-ticket.service";
import {
  CurrentPrintAgent,
  PrintAgentAuthGuard,
} from "./print-agent-auth.guard";
import { agentOperator, parseObjectId } from "./print-agent-credentials";
import { PrintAgentsService } from "./print-agents.service";
import { PrintJobsService } from "./print-jobs.service";
import type { AgentRecord, JobRecord, PrinterRecord } from "./printing-mapper";

function toAgentJob(job: JobRecord): PrintAgentJob {
  return {
    id: String(job._id),
    printerId: String(job.printerId),
    createdAt: job.createdAt.toISOString(),
  };
}

function toAgentPrinter(printer: PrinterRecord): PrintAgentPrinter {
  return {
    id: String(printer._id),
    name: printer.name,
    host: printer.host,
    port: printer.port,
    paperWidth: printer.paperWidth,
    enabled: printer.enabled,
  };
}

function jobIdOf(value: string): Types.ObjectId {
  const id = parseObjectId(value);
  if (id === null) {
    throw new NotFoundException("Print job not found");
  }
  return id;
}

/**
 * 代理程式的 HTTP 端點(路徑與 body 形狀的正本:`@repo/domain/printing` 的 `PRINT_AGENT_API_PATHS`;
 * 說明見 docs/modules/printers.md「代理程式 API」)。不走 GraphQL:呼叫者是店內代理程式、
 * 帶的是代理程式金鑰,不是後台使用者的 access token;圖片也直接回二進位。
 *
 * 錯誤一律 HTTP 狀態碼:400 body 不對、401 金鑰無效或已撤銷 / 配對碼不對、404 不是自己的工作、
 * 409 認領失敗(別人已認領、已逾時、狀態不對)。
 */
@Public()
@Controller("print-agent")
export class PrintAgentController {
  constructor(
    private readonly agents: PrintAgentsService,
    private readonly jobs: PrintJobsService,
    private readonly tickets: RealtimeTicketService,
  ) {}

  /** 配對碼換長期金鑰;過期、用過、不對一律 401(不透露差別)。 */
  @Post("pair")
  @HttpCode(200)
  async pair(@Body() body: unknown): Promise<PrintAgentPairResponse> {
    const { code, version } = (body ?? {}) as {
      code?: unknown;
      version?: unknown;
    };
    const paired = await this.agents.pair(code, version);
    if (paired === null) {
      throw new UnauthorizedException("Invalid or expired pairing code");
    }
    return {
      agentId: String(paired.agent._id),
      key: paired.key,
      name: paired.agent.name,
    };
  }

  /** 未完成的工作(2 分鐘內等待中)與自己的印表機設定;逾時的先標失敗。 */
  @UseGuards(PrintAgentAuthGuard)
  @Get("jobs")
  async pending(
    @CurrentPrintAgent() agent: AgentRecord,
  ): Promise<PrintAgentJobsResponse> {
    const operator = agentOperator(agent.orgId);
    const jobs = await this.jobs.pendingForAgent(operator, agent, new Date());
    const printers = await this.jobs.printersOfAgent(operator, agent);
    return {
      printers: printers.map((printer) => toAgentPrinter(printer)),
      jobs: jobs.map((job) => toAgentJob(job)),
    };
  }

  /** 認領:成功才印。失敗(409)= 別人已認領、已逾時(已標失敗)或已不是等待中。 */
  @UseGuards(PrintAgentAuthGuard)
  @Post("jobs/:id/claim")
  @HttpCode(200)
  async claim(
    @CurrentPrintAgent() agent: AgentRecord,
    @Param("id") id: string,
  ): Promise<PrintAgentClaimResponse> {
    const operator = agentOperator(agent.orgId);
    const claimed = await this.jobs.claim(
      operator,
      agent,
      jobIdOf(id),
      new Date(),
    );
    if (claimed === null) {
      throw new ConflictException("Print job is not claimable");
    }
    const printer = await this.jobs.printerOf(operator, claimed.printerId);
    if (printer === null) {
      throw new NotFoundException("Printer not found");
    }
    return { job: toAgentJob(claimed), printer: toAgentPrinter(printer) };
  }

  /** 已認領工作的 PNG。 */
  @UseGuards(PrintAgentAuthGuard)
  @Get("jobs/:id/image")
  async image(
    @CurrentPrintAgent() agent: AgentRecord,
    @Param("id") id: string,
  ): Promise<StreamableFile> {
    const image = await this.jobs.imageOf(
      agentOperator(agent.orgId),
      agent,
      jobIdOf(id),
    );
    if (image === null) {
      throw new NotFoundException("Print job not found or not claimed");
    }
    return new StreamableFile(image, { type: "image/png" });
  }

  /** 回報結果(已送出 → 已印 / 失敗)。 */
  @UseGuards(PrintAgentAuthGuard)
  @Post("jobs/:id/result")
  @HttpCode(204)
  async result(
    @CurrentPrintAgent() agent: AgentRecord,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const { status, error } = (body ?? {}) as {
      status?: unknown;
      error?: unknown;
    };
    if (!(PRINT_JOB_RESULTS as readonly unknown[]).includes(status)) {
      throw new BadRequestException("status must be printed or failed");
    }
    let reported: PrintAgentReportableError | null = null;
    if (status === "failed") {
      reported = (PRINT_AGENT_REPORTABLE_ERRORS as readonly unknown[]).includes(
        error,
      )
        ? (error as PrintAgentReportableError)
        : "other";
    }
    const updated = await this.jobs.report(
      agentOperator(agent.orgId),
      agent,
      jobIdOf(id),
      status as PrintJobResult,
      reported,
      new Date(),
    );
    if (updated === null) {
      throw new ConflictException("Print job is not in the sent state");
    }
  }

  /** 換即時通道的訂閱憑證(`print-agent:<自己>`);即時通道停用時三個欄位都是 null。 */
  @UseGuards(PrintAgentAuthGuard)
  @Post("realtime-ticket")
  @HttpCode(200)
  async realtimeTicket(
    @CurrentPrintAgent() agent: AgentRecord,
  ): Promise<PrintAgentTicketResponse> {
    const grant = await this.tickets.issueForAgent(
      agent.tenantId,
      String(agent._id),
    );
    return {
      ticket: grant?.ticket ?? null,
      connectUrl: grant?.connectUrl ?? null,
      expiresAt: grant?.expiresAt ?? null,
    };
  }

  /** 心跳:版本與印表機狀態(`lastSeenAt` 由守門記)。 */
  @UseGuards(PrintAgentAuthGuard)
  @Post("heartbeat")
  @HttpCode(204)
  async heartbeat(
    @CurrentPrintAgent() agent: AgentRecord,
    @Body() body: unknown,
  ): Promise<void> {
    await this.agents.heartbeat(agent, body);
  }
}
