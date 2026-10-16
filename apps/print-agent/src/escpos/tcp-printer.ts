import { type Socket, createConnection } from "node:net";

import type { PrintAgentPrinter, PrinterStatus } from "@repo/domain/printing";

import type { Logger } from "../logging/logger";
import {
  PAPER_STATUS_REQUEST,
  type PaperStatus,
  parsePaperStatus,
} from "./commands";
import type { PrintOutcome, PrinterTransport } from "./transport";

/**
 * TCP 9100(RAW)送 ESC/POS 指令(底座規格第 6 章 `escpos`:TCP 9100 連線與逾時;`DLE EOT` 讀狀態)。
 *
 * 一張單據一條連線:連線 → `DLE EOT 4` 查紙(缺紙就不送、回報 `paper-out`)→ 依序寫出各段 → 關閉。
 * 查紙沒有回應(有些機型關掉了即時狀態回傳)時照常列印,不當成錯誤;每台第一次遇到時記一次 warn。
 *
 * **總期限**:連線、查紙、寫入到關閉共用一個期限(`jobTimeoutMs`)。收據機接受連線卻不收資料(卡紙、
 * 韌體當掉)時,寫入會一直等;期限到就 destroy 連線、回報 `other`,佇列裡的下一張照常進行。
 */
export interface TcpPrinterOptions {
  connectTimeoutMs?: number;
  /** 等 `DLE EOT` 回應多久。 */
  statusTimeoutMs?: number;
  /** 一張單據從連線到關閉的總期限。 */
  jobTimeoutMs?: number;
  logger?: Logger;
}

export const CONNECT_TIMEOUT_MS = 5000;
export const STATUS_TIMEOUT_MS = 1500;
export const JOB_TIMEOUT_MS = 30_000;

class PrinterConnection {
  private readonly received: number[] = [];
  private waiter: (() => void) | null = null;
  private failure: Error | null = null;

  private constructor(private readonly socket: Socket) {
    socket.on("data", (data: Buffer) => {
      this.received.push(...data);
      this.wake();
    });
    socket.on("error", (error) => {
      this.failure = error;
      this.wake();
    });
    socket.on("close", () => {
      this.failure ??= new Error("連線已關閉");
      this.wake();
    });
  }

  static open(
    host: string,
    port: number,
    timeoutMs: number,
  ): Promise<PrinterConnection> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port });
      socket.setNoDelay(true);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`連線逾時(${String(timeoutMs)}ms)`));
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(new PrinterConnection(socket));
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      });
    });
  }

  private wake(): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.();
  }

  /** 讀一個 byte;逾時或連線斷掉回 null。 */
  async readByte(timeoutMs: number): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (this.received.length === 0 && this.failure === null) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return null;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.waiter = null;
          resolve();
        }, remaining);
        this.waiter = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    return this.received.shift() ?? null;
  }

  /** 寫一段;對方不收資料時 callback 不會回來(由呼叫端的總期限收尾)。 */
  write(chunk: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.failure !== null) {
        reject(this.failure);
        return;
      }
      this.socket.write(chunk, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 寫完後半關閉(FIN)。`end` 的 callback 在資料都交給作業系統送出時(`finish`)就回來,
   * **不代表收據機已經收下或印完**;ESC/POS 的 RAW 埠沒有「已印」的確認,能確認的只到這裡。
   */
  finish(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.end(() => {
        this.socket.destroy();
        resolve();
      });
    });
  }

  destroy(): void {
    this.socket.destroy();
  }
}

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export class TcpPrinterTransport implements PrinterTransport {
  private readonly connectTimeoutMs: number;
  private readonly statusTimeoutMs: number;
  private readonly jobTimeoutMs: number;
  /** 已經記過「沒回 DLE EOT」的印表機(每台只記一次)。 */
  private readonly silentStatus = new Set<string>();

  constructor(private readonly options: TcpPrinterOptions = {}) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.statusTimeoutMs = options.statusTimeoutMs ?? STATUS_TIMEOUT_MS;
    this.jobTimeoutMs = options.jobTimeoutMs ?? JOB_TIMEOUT_MS;
  }

  async print(
    printer: PrintAgentPrinter,
    chunks: readonly Uint8Array[],
  ): Promise<PrintOutcome> {
    const state: { connection: PrinterConnection | null; expired: boolean } = {
      connection: null,
      expired: false,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<PrintOutcome>((resolve) => {
      timer = setTimeout(() => {
        state.expired = true;
        state.connection?.destroy();
        resolve({
          ok: false,
          error: "other",
          detail: `列印逾時(${String(this.jobTimeoutMs)}ms):收據機沒有收下資料`,
        });
      }, this.jobTimeoutMs);
    });
    try {
      return await Promise.race([this.send(printer, chunks, state), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async status(printer: PrintAgentPrinter): Promise<PrinterStatus> {
    let connection: PrinterConnection;
    try {
      connection = await PrinterConnection.open(
        printer.host,
        printer.port,
        this.connectTimeoutMs,
      );
    } catch {
      return "offline";
    }
    try {
      const paper = await this.queryPaper(printer, connection);
      return paper === "paper-out" ? "paper-out" : "ok";
    } catch {
      return "ok";
    } finally {
      connection.destroy();
    }
  }

  private async send(
    printer: PrintAgentPrinter,
    chunks: readonly Uint8Array[],
    state: { connection: PrinterConnection | null; expired: boolean },
  ): Promise<PrintOutcome> {
    let connection: PrinterConnection;
    try {
      connection = await PrinterConnection.open(
        printer.host,
        printer.port,
        Math.min(this.connectTimeoutMs, this.jobTimeoutMs),
      );
    } catch (error) {
      return { ok: false, error: "printer-offline", detail: describe(error) };
    }
    state.connection = connection;
    if (state.expired) {
      // 期限已過才連上:不送了(結果已由期限回報)
      connection.destroy();
      return { ok: false, error: "other", detail: "列印逾時" };
    }
    try {
      const paper = await this.queryPaper(printer, connection);
      if (paper === "paper-out") {
        connection.destroy();
        return { ok: false, error: "paper-out", detail: "缺紙" };
      }
      for (const chunk of chunks) {
        await connection.write(chunk);
      }
      await connection.finish();
      return { ok: true };
    } catch (error) {
      connection.destroy();
      return { ok: false, error: "other", detail: describe(error) };
    }
  }

  private async queryPaper(
    printer: PrintAgentPrinter,
    connection: PrinterConnection,
  ): Promise<PaperStatus> {
    await connection.write(PAPER_STATUS_REQUEST);
    const byte = await connection.readByte(this.statusTimeoutMs);
    if (byte === null && !this.silentStatus.has(printer.id)) {
      this.silentStatus.add(printer.id);
      this.options.logger?.warn(
        "收據機沒有回應 DLE EOT 4(查不到缺紙狀態):照常列印;請確認機型是否開啟即時狀態回傳",
        { printerId: printer.id, host: printer.host },
      );
    }
    return byte === null ? "unknown" : parsePaperStatus(byte);
  }
}
