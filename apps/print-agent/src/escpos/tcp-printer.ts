import { type Socket, createConnection } from "node:net";

import type { PrintAgentPrinter, PrinterStatus } from "@repo/domain/printing";

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
 * 查紙沒有回應(有些機型關掉了即時狀態回傳)時照常列印,不當成錯誤。
 */
export interface TcpPrinterOptions {
  connectTimeoutMs?: number;
  /** 等 `DLE EOT` 回應多久。 */
  statusTimeoutMs?: number;
  /** 整張單據寫完(含收據機收下)的上限。 */
  writeTimeoutMs?: number;
}

export const CONNECT_TIMEOUT_MS = 5000;
export const STATUS_TIMEOUT_MS = 1500;
export const WRITE_TIMEOUT_MS = 30_000;

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

  /** 寫完後半關閉,等對方收下(對方關閉或 socket 排空)。 */
  finish(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.destroy();
        reject(new Error(`送出逾時(${String(timeoutMs)}ms)`));
      }, timeoutMs);
      this.socket.end(() => {
        clearTimeout(timer);
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
  private readonly writeTimeoutMs: number;

  constructor(options: TcpPrinterOptions = {}) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.statusTimeoutMs = options.statusTimeoutMs ?? STATUS_TIMEOUT_MS;
    this.writeTimeoutMs = options.writeTimeoutMs ?? WRITE_TIMEOUT_MS;
  }

  async print(
    printer: PrintAgentPrinter,
    chunks: readonly Uint8Array[],
  ): Promise<PrintOutcome> {
    let connection: PrinterConnection;
    try {
      connection = await PrinterConnection.open(
        printer.host,
        printer.port,
        this.connectTimeoutMs,
      );
    } catch (error) {
      return { ok: false, error: "printer-offline", detail: describe(error) };
    }
    try {
      const paper = await this.queryPaper(connection);
      if (paper === "paper-out") {
        connection.destroy();
        return { ok: false, error: "paper-out", detail: "缺紙" };
      }
      for (const chunk of chunks) {
        await connection.write(chunk);
      }
      await connection.finish(this.writeTimeoutMs);
      return { ok: true };
    } catch (error) {
      connection.destroy();
      return { ok: false, error: "other", detail: describe(error) };
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
      const paper = await this.queryPaper(connection);
      return paper === "paper-out" ? "paper-out" : "ok";
    } catch {
      return "ok";
    } finally {
      connection.destroy();
    }
  }

  private async queryPaper(
    connection: PrinterConnection,
  ): Promise<PaperStatus> {
    await connection.write(PAPER_STATUS_REQUEST);
    const byte = await connection.readByte(this.statusTimeoutMs);
    return byte === null ? "unknown" : parsePaperStatus(byte);
  }
}
