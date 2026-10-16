import type {
  PrintAgentReportableError,
  PrintJobResult,
  PrinterPaperWidth,
  PrinterStatus,
} from "./constants";

/**
 * 代理程式 ↔ API 的 HTTP 協定(底座規格第 6 章「配對」「代理程式」)。
 *
 * - 伺服器網址 = API 的 origin(與後台打的 GraphQL 同一台);下面的路徑都接在它後面。
 * - 除了配對,每個請求都帶 `Authorization: Bearer <代理程式金鑰>`;金鑰被撤銷(重新配對、停用)後一律 401。
 * - 每個帶金鑰的請求都算一次「看到代理程式」(更新 `lastSeenAt`)。
 * - JSON 欄位的時間一律 ISO 8601 字串。
 */
export const PRINT_AGENT_API_PATHS = {
  /** `POST`:配對碼換長期金鑰(不帶金鑰)。 */
  pair: "/print-agent/pair",
  /** `GET`:未完成的工作(等待中、2 分鐘內)+ 自己的印表機設定。 */
  jobs: "/print-agent/jobs",
  /** `POST`:認領(等待中 → 已送出);成功才印。 */
  claim: (jobId: string) => `/print-agent/jobs/${jobId}/claim`,
  /** `GET`:工作的 PNG(只有已送出、自己認領的工作)。 */
  image: (jobId: string) => `/print-agent/jobs/${jobId}/image`,
  /** `POST`:回報結果(已送出 → 已印 / 失敗)。 */
  result: (jobId: string) => `/print-agent/jobs/${jobId}/result`,
  /** `POST`:換即時通道的訂閱憑證(`print-agent:<自己>`)。 */
  realtimeTicket: "/print-agent/realtime-ticket",
  /** `POST`:心跳:回報 `version` 與印表機狀態。 */
  heartbeat: "/print-agent/heartbeat",
} as const;

/** `POST /print-agent/pair` 的 body。 */
export interface PrintAgentPairRequest {
  /** 8 碼配對碼(大小寫、空白、連字號不拘)。 */
  code: string;
  /** 代理程式版本(semver),選填。 */
  version?: string;
}

/** 配對成功的回應:金鑰只出現這一次,代理程式寫進本機設定檔。 */
export interface PrintAgentPairResponse {
  agentId: string;
  /** 長期代理程式金鑰;資料庫只存雜湊。 */
  key: string;
  name: string;
}

/** 代理程式要連的印表機設定。 */
export interface PrintAgentPrinter {
  id: string;
  name: string;
  host: string;
  port: number;
  paperWidth: PrinterPaperWidth;
  enabled: boolean;
}

/** 一張等待中的工作(圖片另外用 `image` 取)。 */
export interface PrintAgentJob {
  id: string;
  printerId: string;
  /** 建立時間;超過 2 分鐘的工作 API 已標失敗,不會出現在清單。 */
  createdAt: string;
}

/** `GET /print-agent/jobs` 的回應。 */
export interface PrintAgentJobsResponse {
  printers: PrintAgentPrinter[];
  jobs: PrintAgentJob[];
}

/** `POST .../claim` 成功的回應(失敗 = 409:別人已認領、已逾時或已不是等待中)。 */
export interface PrintAgentClaimResponse {
  job: PrintAgentJob;
  printer: PrintAgentPrinter;
}

/** `POST .../result` 的 body。 */
export interface PrintAgentResultRequest {
  status: PrintJobResult;
  /** `status = failed` 時必填。 */
  error?: PrintAgentReportableError;
}

/** `POST /print-agent/realtime-ticket` 的回應;即時通道停用時 `ticket` 為 null(改 60 秒輪詢)。 */
export interface PrintAgentTicketResponse {
  ticket: string | null;
  connectUrl: string | null;
  /** 到期時間(Unix 秒)。 */
  expiresAt: number | null;
}

/** `POST /print-agent/heartbeat` 的 body。 */
export interface PrintAgentHeartbeatRequest {
  /** 代理程式版本(semver)。 */
  version: string;
  /** 各印表機的狀態;不在自己名下的印表機會被忽略。 */
  printers?: { id: string; status: PrinterStatus }[];
}
