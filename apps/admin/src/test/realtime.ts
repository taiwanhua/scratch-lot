import type {
  RealtimeGrant,
  RealtimeSocket,
  RealtimeTimers,
} from "@/lib/base/realtime/realtime-connection";

type Listener = (event: never) => void;

/** 假的 WebSocket:記下送出的訊息,測試端用 `open()` / `receive()` / `drop()` 驅動。 */
export class FakeSocket implements RealtimeSocket {
  readonly sent: unknown[] = [];
  closedWith: number | null = null;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000): void {
    this.closedWith = code;
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as never);
    }
  }

  open(): void {
    this.emit("open", {});
  }

  receive(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  /** 伺服器端關閉 / 網路斷線。 */
  drop(code = 1006): void {
    this.emit("close", { code });
  }
}

/** 手動推進的計時器:`advance(ms)` 依時間順序執行到期的工作(工作裡新排的也算)。 */
export class ManualTimers implements RealtimeTimers {
  private current = 1_800_000_000_000;
  private seq = 0;
  private readonly pending = new Map<number, { at: number; run: () => void }>();

  now(): number {
    return this.current;
  }

  set(callback: () => void, delayMs: number): unknown {
    this.seq += 1;
    this.pending.set(this.seq, { at: this.current + delayMs, run: callback });
    return this.seq;
  }

  clear(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    for (;;) {
      const next = [...this.pending.entries()]
        .filter(([, job]) => job.at <= target)
        .toSorted(([, a], [, b]) => a.at - b.at)
        .at(0);
      if (next === undefined) {
        break;
      }
      const [id, job] = next;
      this.pending.delete(id);
      this.current = Math.max(this.current, job.at);
      job.run();
      await flushPromises();
    }
    this.current = target;
  }
}

/** 讓排隊中的 promise(拿憑證)跑完。 */
export const flushPromises = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
};

export const grantOf = (
  timers: ManualTimers,
  topics: string[] = ["user:u1"],
  ticket = "t1",
): RealtimeGrant => ({
  ticket,
  connectUrl: "wss://rt.test/connect",
  expiresAt: Math.floor(timers.now() / 1000) + 600,
  topics,
});
