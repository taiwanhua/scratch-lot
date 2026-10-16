import {
  PRINT_AGENT_API_PATHS,
  type PrintAgentClaimResponse,
  type PrintAgentHeartbeatRequest,
  type PrintAgentJobsResponse,
  type PrintAgentPairRequest,
  type PrintAgentPairResponse,
  type PrintAgentResultRequest,
  type PrintAgentTicketResponse,
} from "@repo/domain/printing";

/**
 * 代理程式 → API 的 HTTP 客戶端。路徑與 body 形狀的正本是 `@repo/domain/printing` 的
 * `PRINT_AGENT_API_PATHS` 與型別(api 端:`apps/api/src/printing/print-agent.controller.ts`),這裡不另訂。
 *
 * 錯誤對照(controller 的約定):401 金鑰無效 / 已撤銷(重新配對、停用)或配對碼不對;
 * 404 不是自己的工作;409 認領失敗(別人已認領、已逾時、狀態不對)或回報時已不是「已送出」。
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class PrintAgentApiError extends Error {
  override readonly name = "PrintAgentApiError";

  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`API ${path} 回應 ${String(status)}`);
  }

  /** 金鑰無效或已撤銷:要重新配對才能再用。 */
  get unauthorized(): boolean {
    return this.status === 401;
  }
}

/** 代理程式用到的 API(job-runner / agent 依賴這個介面,測試換成假的)。 */
export interface AgentApi {
  jobs(): Promise<PrintAgentJobsResponse>;
  /** 認領;別人已認領、已逾時、不是自己的(409 / 404)回 null。 */
  claim(jobId: string): Promise<PrintAgentClaimResponse | null>;
  image(jobId: string): Promise<Uint8Array>;
  /** 回報結果;工作已不是「已送出」(409,例:已逾時標失敗)回 false。 */
  result(jobId: string, body: PrintAgentResultRequest): Promise<boolean>;
  ticket(): Promise<PrintAgentTicketResponse>;
  heartbeat(body: PrintAgentHeartbeatRequest): Promise<void>;
}

export const API_TIMEOUT_MS = 15_000;

export interface ApiClientOptions {
  serverUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

function request(
  options: ApiClientOptions,
  method: "GET" | "POST",
  path: string,
  { key, body }: { key?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (key !== undefined) {
    headers.authorization = `Bearer ${key}`;
  }
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  return (options.fetch ?? defaultFetch)(`${options.serverUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? API_TIMEOUT_MS),
  });
}

/** 讀掉 body 讓連線可以重用。 */
async function drain(response: Response): Promise<void> {
  await response.arrayBuffer().catch(() => null);
}

async function expectOk(response: Response, path: string): Promise<Response> {
  if (!response.ok) {
    await drain(response);
    throw new PrintAgentApiError(response.status, path);
  }
  return response;
}

/** 配對碼換長期金鑰(不帶金鑰);配對碼不對 / 過期 / 用過 → `PrintAgentApiError(401)`。 */
export async function pairWithServer(
  options: ApiClientOptions,
  body: PrintAgentPairRequest,
): Promise<PrintAgentPairResponse> {
  const path = PRINT_AGENT_API_PATHS.pair;
  const response = await expectOk(
    await request(options, "POST", path, { body }),
    path,
  );
  return (await response.json()) as PrintAgentPairResponse;
}

export class PrintAgentApiClient implements AgentApi {
  constructor(private readonly options: ApiClientOptions & { key: string }) {}

  async jobs(): Promise<PrintAgentJobsResponse> {
    const path = PRINT_AGENT_API_PATHS.jobs;
    const response = await expectOk(await this.call("GET", path), path);
    return (await response.json()) as PrintAgentJobsResponse;
  }

  async claim(jobId: string): Promise<PrintAgentClaimResponse | null> {
    const path = PRINT_AGENT_API_PATHS.claim(encodeURIComponent(jobId));
    const response = await this.call("POST", path);
    if (response.status === 409 || response.status === 404) {
      await drain(response);
      return null;
    }
    await expectOk(response, path);
    return (await response.json()) as PrintAgentClaimResponse;
  }

  async image(jobId: string): Promise<Uint8Array> {
    const path = PRINT_AGENT_API_PATHS.image(encodeURIComponent(jobId));
    const response = await expectOk(await this.call("GET", path), path);
    return new Uint8Array(await response.arrayBuffer());
  }

  async result(jobId: string, body: PrintAgentResultRequest): Promise<boolean> {
    const path = PRINT_AGENT_API_PATHS.result(encodeURIComponent(jobId));
    const response = await this.call("POST", path, body);
    if (response.status === 409) {
      await drain(response);
      return false;
    }
    await expectOk(response, path);
    await drain(response);
    return true;
  }

  async ticket(): Promise<PrintAgentTicketResponse> {
    const path = PRINT_AGENT_API_PATHS.realtimeTicket;
    const response = await expectOk(await this.call("POST", path), path);
    return (await response.json()) as PrintAgentTicketResponse;
  }

  async heartbeat(body: PrintAgentHeartbeatRequest): Promise<void> {
    const path = PRINT_AGENT_API_PATHS.heartbeat;
    const response = await expectOk(await this.call("POST", path, body), path);
    await drain(response);
  }

  private call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return request(this.options, method, path, {
      key: this.options.key,
      body,
    });
  }
}
