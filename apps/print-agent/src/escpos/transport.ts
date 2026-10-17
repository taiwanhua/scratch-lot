import type {
  PrintAgentPrinter,
  PrintAgentReportableError,
  PrinterStatus,
} from "@repo/domain/printing";

/** 送出一張單據的結果:失敗原因直接是要回報給 API 的值(`PRINT_AGENT_REPORTABLE_ERRORS`)。 */
export type PrintOutcome =
  | { ok: true }
  | { ok: false; error: PrintAgentReportableError; detail: string };

/**
 * 「把 ESC/POS 指令送到印表機」的介面:正式是 TCP 9100(`TcpPrinterTransport`),
 * 開發與測試是模擬印表機(`SimulatorTransport`,存成圖片檔)。
 */
export interface PrinterTransport {
  print(
    printer: PrintAgentPrinter,
    chunks: readonly Uint8Array[],
  ): Promise<PrintOutcome>;
  /** 心跳回報用的印表機狀態(正常 / 缺紙 / 離線)。 */
  status(printer: PrintAgentPrinter): Promise<PrinterStatus>;
}
