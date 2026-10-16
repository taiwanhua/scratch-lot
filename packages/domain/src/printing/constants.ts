/**
 * 列印(底座規格第 6 章 B8)的共用常數:api 與代理程式(`apps/print-agent`)同一份。
 * 本檔只有常數與純函式,不依賴 Node / 瀏覽器 API。
 */

/** 離線判斷:`lastSeenAt` 超過這段時間 = 離線(底座規格「離線、逾時、重新配對與停用」)。 */
export const PRINT_AGENT_OFFLINE_AFTER_MS = 2 * 60 * 1000;

/** 工作逾時:「等待中」超過這段時間沒有被認領 → 標失敗「代理程式離線」。 */
export const PRINT_JOB_CLAIM_TIMEOUT_MS = 2 * 60 * 1000;

/** 結果逾時:「已送出」(認領後)超過這段時間沒有回報 → 標失敗「未收到列印結果」。 */
export const PRINT_JOB_RESULT_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * 代理程式回報心跳(`version` 與印表機狀態)的間隔:要小於離線判斷,
 * 連著即時通道、沒有工作進來時也靠它讓 `lastSeenAt` 保持在 2 分鐘內。
 */
export const PRINT_AGENT_HEARTBEAT_INTERVAL_MS = 60 * 1000;

/** 即時通道故障時的輪詢間隔(底座規格「架構」:降級為每 60 秒詢問)。 */
export const PRINT_AGENT_POLL_INTERVAL_MS = 60 * 1000;

/** 配對碼效期(10 分鐘)。 */
export const PRINT_PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

/** 配對碼長度(8 碼)。 */
export const PRINT_PAIRING_CODE_LENGTH = 8;

/** 配對碼字元集:大寫英數去掉易混淆的 `0 O 1 I`(人要從畫面抄到店內電腦)。 */
export const PRINT_PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 印表機的連接埠預設值(ESC/POS 網路印表機的 RAW 埠)。 */
export const PRINTER_DEFAULT_PORT = 9100;

/** 紙寬(mm);底座只支援 58mm(可列印寬 384 點)。 */
export const PRINTER_PAPER_WIDTHS = [58] as const;
export type PrinterPaperWidth = (typeof PRINTER_PAPER_WIDTHS)[number];

/** 各紙寬對應的影像寬度(點):瀏覽器轉出的黑白 PNG 必須是這個寬。 */
export const PRINT_IMAGE_WIDTH_DOTS: Readonly<
  Record<PrinterPaperWidth, number>
> = { 58: 384 };

/** 一張列印影像(PNG)的大小上限(bytes)。 */
export const PRINT_IMAGE_MAX_BYTES = 512 * 1024;

/**
 * 一張列印影像的高度上限(點)。58mm 收據機 8 點/mm,8000 點 = 100cm 紙長:
 * 一般單據(表頭、明細、合計、QR code、簽名欄)約 10–40cm,留到一公尺給長明細;
 * 再長多半是程式錯誤(例:把整頁轉成圖片),會一口氣吐出一大段紙。api 收圖與代理程式開印前都檢查。
 */
export const PRINT_IMAGE_MAX_HEIGHT_DOTS = 8000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 只讀 PNG 的 IHDR(不解碼):回寬高;不是 PNG 回 null。 */
export function readPngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (
    bytes.length < 24 ||
    PNG_SIGNATURE.some((value, index) => bytes[index] !== value) ||
    String.fromCodePoint(...bytes.subarray(12, 16)) !== "IHDR"
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** 工作狀態:等待中 → 已送出(代理程式認領)→ 已印 / 失敗。 */
export const PRINT_JOB_STATUSES = [
  "pending",
  "sent",
  "printed",
  "failed",
] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

/** 代理程式回報的結果(只能從「已送出」轉過去)。 */
export const PRINT_JOB_RESULTS = ["printed", "failed"] as const;
export type PrintJobResult = (typeof PRINT_JOB_RESULTS)[number];

/**
 * 失敗原因(`print_jobs.error`;前端依它顯示「✗ 失敗:<原因>」):
 * - `agent-offline`:送出時代理程式已離線,或等待中超過 2 分鐘沒有被認領
 * - `agent-disabled`:代理程式被停用時還在等待中或已送出(還沒回報)的工作
 * - `no-result`:已送出(代理程式已認領)超過 2 分鐘沒有回報結果 —— 可能已經印出來,按鈕要與「代理程式離線」分開說
 * - `paper-out`:缺紙
 * - `printer-offline`:連不上印表機(TCP 9100 連線失敗 / 逾時)
 * - `other`:其他(代理程式回報不認得的原因時也歸這裡)
 */
export const PRINT_JOB_ERRORS = [
  "agent-offline",
  "agent-disabled",
  "no-result",
  "paper-out",
  "printer-offline",
  "other",
] as const;
export type PrintJobError = (typeof PRINT_JOB_ERRORS)[number];

/** 代理程式能回報的失敗原因(`agent-*` 由 API 自己判斷,代理程式不回報)。 */
export const PRINT_AGENT_REPORTABLE_ERRORS = [
  "paper-out",
  "printer-offline",
  "other",
] as const satisfies readonly PrintJobError[];
export type PrintAgentReportableError =
  (typeof PRINT_AGENT_REPORTABLE_ERRORS)[number];

/** 印表機狀態(代理程式心跳回報):正常 / 缺紙 / 離線。 */
export const PRINTER_STATUSES = ["ok", "paper-out", "offline"] as const;
export type PrinterStatus = (typeof PRINTER_STATUSES)[number];

/** 即時信號類型(RT-02:只有類型與工作 id)。 */
export const PRINT_SIGNALS = {
  /** API → `print-agent:<代理程式 id>`:有新工作,`id` = 工作 id。 */
  job: "print-job",
  /** API → `user:<要求人 id>`:工作有結果(已印 / 失敗),`id` = 工作 id。 */
  result: "print-result",
} as const;

/** 補印原因的欄位類別 key(欄位管理的系統類別,底座 seed 宣告)。 */
export const REPRINT_REASON_CATEGORY_KEY = "reprint-reason";

/** 補印原因的底座選項值;選「其他」時 `reprintNote` 必填。 */
export const REPRINT_REASONS = ["lost", "damaged", "other"] as const;
export const REPRINT_REASON_OTHER = "other";

/** 測試頁(`[測試列印]`)的單據類型與關聯類型(`refId` = 印表機 id)。 */
export const PRINT_TEST_PAGE_DOCUMENT_TYPE = "printer-test-page";
export const PRINT_TEST_PAGE_REF_TYPE = "printer";

/** 配對碼正規化:去掉空白與連字號、轉大寫;格式不對回 null。 */
export function normalizePairingCode(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const code = input.replaceAll(/[\s-]/g, "").toUpperCase();
  if (code.length !== PRINT_PAIRING_CODE_LENGTH) {
    return null;
  }
  for (const char of code) {
    if (!PRINT_PAIRING_CODE_ALPHABET.includes(char)) {
      return null;
    }
  }
  return code;
}

/** 這個時間點的代理程式算不算離線(`lastSeenAt` 沒有值 = 從沒連過 = 離線)。 */
export function isPrintAgentOffline(
  lastSeenAt: Date | null | undefined,
  now: Date,
): boolean {
  return (
    lastSeenAt === null ||
    lastSeenAt === undefined ||
    now.getTime() - lastSeenAt.getTime() > PRINT_AGENT_OFFLINE_AFTER_MS
  );
}
