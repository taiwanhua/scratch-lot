import { randomBytes } from "node:crypto";

import { PNG } from "pngjs";

import type {
  PrintAgentClaimResponse,
  PrintAgentHeartbeatRequest,
  PrintAgentJob,
  PrintAgentJobsResponse,
  PrintAgentPrinter,
  PrintAgentResultRequest,
  PrintAgentTicketResponse,
  PrinterStatus,
} from "@repo/domain/printing";

import type { AgentApi } from "../api-client/api-client";
import type { PrintOutcome, PrinterTransport } from "../escpos/transport";
import type { LogFields, LogLevel, Logger } from "../logging/logger";
import type { AgentSocket } from "../realtime/realtime-link";
import type { Timers } from "../timers";

/** 測試用的金鑰 / 憑證:每次現產,不入 repo。 */
export const freshSecret = (): string => randomBytes(24).toString("base64url");

/** 讓排在 microtask / setImmediate 的工作跑完。 */
export async function flush(rounds = 20): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** 手動推進的計時器:`advance(ms)` 依時間順序觸發到期的 callback,每觸發一個就 flush 一次。 */
export class ManualTimers implements Timers {
  private current = 0;
  private sequence = 0;
  private readonly tasks = new Map<
    number,
    { at: number; callback: () => void }
  >();

  now(): number {
    return this.current;
  }

  set(callback: () => void, delayMs: number): unknown {
    this.sequence += 1;
    this.tasks.set(this.sequence, { at: this.current + delayMs, callback });
    return this.sequence;
  }

  clear(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  get pending(): number {
    return this.tasks.size;
  }

  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      await flush();
      let next: [number, { at: number; callback: () => void }] | undefined;
      for (const entry of this.tasks) {
        if (
          entry[1].at <= target &&
          (next === undefined || entry[1].at < next[1].at)
        ) {
          next = entry;
        }
      }
      if (next === undefined) {
        break;
      }
      this.tasks.delete(next[0]);
      this.current = next[1].at;
      next[1].callback();
    }
    this.current = target;
    await flush();
  }
}

export class MemoryLogger implements Logger {
  readonly lines: { level: LogLevel; message: string; fields?: LogFields }[] =
    [];

  info(message: string, fields?: LogFields): void {
    this.lines.push({ level: "info", message, fields });
  }

  warn(message: string, fields?: LogFields): void {
    this.lines.push({ level: "warn", message, fields });
  }

  error(message: string, fields?: LogFields): void {
    this.lines.push({ level: "error", message, fields });
  }
}

/** 一張純黑白的測試 PNG:`rows` 的每個字元一個點,`#` 黑、其他白。 */
export function pngFromRows(
  rows: readonly string[],
  width?: number,
): Uint8Array {
  const w = width ?? Math.max(...rows.map((row) => row.length));
  const png = new PNG({ width: w, height: rows.length });
  png.data.fill(255);
  for (const [y, row] of rows.entries()) {
    for (let x = 0; x < w; x += 1) {
      if (row[x] === "#") {
        const offset = (y * w + x) * 4;
        png.data[offset] = 0;
        png.data[offset + 1] = 0;
        png.data[offset + 2] = 0;
      }
    }
  }
  return new Uint8Array(PNG.sync.write(png));
}

export function samplePrinter(
  overrides: Partial<PrintAgentPrinter> = {},
): PrintAgentPrinter {
  return {
    id: "printer-1",
    name: "櫃台",
    host: "127.0.0.1",
    port: 9100,
    paperWidth: 58,
    enabled: true,
    ...overrides,
  };
}

/**
 * 假 API:照 T33 的認領語意 —— 只有「等待中」的工作能認領(條件更新),第二次認領一律 409(這裡回 null)。
 */
export class FakeAgentApi implements AgentApi {
  readonly printers: PrintAgentPrinter[] = [samplePrinter()];
  readonly jobsById = new Map<
    string,
    { job: PrintAgentJob; status: "pending" | "sent" | "printed" | "failed" }
  >();
  readonly calls: string[] = [];
  readonly results: { jobId: string; body: PrintAgentResultRequest }[] = [];
  readonly heartbeats: PrintAgentHeartbeatRequest[] = [];
  readonly images = new Map<string, Uint8Array>();
  ticketResponse: PrintAgentTicketResponse = {
    ticket: freshSecret(),
    connectUrl: "wss://rt.example.invalid/connect",
    expiresAt: 0,
  };
  failure: Error | null = null;

  addJob(id: string, image = pngFromRows(["#".repeat(8)])): void {
    this.jobsById.set(id, {
      job: { id, printerId: "printer-1", createdAt: new Date(0).toISOString() },
      status: "pending",
    });
    this.images.set(id, image);
  }

  private guard(name: string): void {
    this.calls.push(name);
    if (this.failure !== null) {
      throw this.failure;
    }
  }

  jobs(): Promise<PrintAgentJobsResponse> {
    this.guard("jobs");
    return Promise.resolve({
      printers: this.printers,
      jobs: [...this.jobsById.values()]
        .filter((entry) => entry.status === "pending")
        .map((entry) => entry.job),
    });
  }

  claim(jobId: string): Promise<PrintAgentClaimResponse | null> {
    this.guard(`claim:${jobId}`);
    const entry = this.jobsById.get(jobId);
    if (entry?.status !== "pending") {
      return Promise.resolve(null);
    }
    entry.status = "sent";
    const printer = this.printers.find(
      (item) => item.id === entry.job.printerId,
    );
    return Promise.resolve(
      printer === undefined ? null : { job: entry.job, printer },
    );
  }

  image(jobId: string): Promise<Uint8Array> {
    this.guard(`image:${jobId}`);
    const image = this.images.get(jobId);
    if (image === undefined) {
      throw new Error("no image");
    }
    return Promise.resolve(image);
  }

  result(jobId: string, body: PrintAgentResultRequest): Promise<boolean> {
    this.guard(`result:${jobId}`);
    const entry = this.jobsById.get(jobId);
    if (entry?.status !== "sent") {
      return Promise.resolve(false);
    }
    entry.status = body.status;
    this.results.push({ jobId, body });
    return Promise.resolve(true);
  }

  ticket(): Promise<PrintAgentTicketResponse> {
    this.guard("ticket");
    return Promise.resolve(this.ticketResponse);
  }

  heartbeat(body: PrintAgentHeartbeatRequest): Promise<void> {
    this.guard("heartbeat");
    this.heartbeats.push(body);
    return Promise.resolve();
  }
}

/** 假印表機:記下每次送出的指令。 */
export class RecordingTransport implements PrinterTransport {
  readonly printed: { printerId: string; chunks: readonly Uint8Array[] }[] = [];
  outcome: PrintOutcome = { ok: true };
  printerStatus: PrinterStatus = "ok";

  print(
    printer: PrintAgentPrinter,
    chunks: readonly Uint8Array[],
  ): Promise<PrintOutcome> {
    this.printed.push({ printerId: printer.id, chunks });
    return Promise.resolve(this.outcome);
  }

  status(): Promise<PrinterStatus> {
    return Promise.resolve(this.printerStatus);
  }
}

/** 假 WebSocket:測試從外面觸發 open / message / close。 */
export class FakeSocket implements AgentSocket {
  readonly sent: string[] = [];
  closed: { code?: number } | null = null;
  private readonly listeners = new Map<string, ((event: never) => void)[]>();

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.closed = { code };
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: "open" | "message" | "close", event: unknown = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as never);
    }
  }

  open(): void {
    this.emit("open");
  }

  message(value: unknown): void {
    this.emit("message", { data: JSON.stringify(value) });
  }

  drop(code = 1006): void {
    this.emit("close", { code });
  }
}
