import type { RealtimeSignal } from "@repo/domain/realtime";

/** 同一頻道同一類型的信號,每 2 秒最多送一次(底座規格第 4 章「頻道」)。 */
export const SIGNAL_COALESCE_WINDOW_MS = 2000;

/** 清掉過期紀錄的門檻:記錄數超過它才掃一次,平常不掃。 */
const SWEEP_THRESHOLD = 1000;

export type FlushSignal = (
  hub: string,
  topics: readonly string[],
  signal: RealtimeSignal,
) => Promise<void>;

export interface CoalescerClock {
  now(): number;
  schedule(callback: () => void, delayMs: number): void;
}

const systemClock: CoalescerClock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    // 不讓排著的補送擋住行程結束(關機、測試結束)
    setTimeout(callback, delayMs).unref();
  },
};

interface Trailing {
  hub: string;
  topic: string;
  signal: RealtimeSignal;
}

/**
 * 送出端的高頻信號合併:以「租戶 + 頻道 + 信號類型」為單位,**前緣立即送、窗內的併成窗尾一次**:
 *
 * - 距離上次送出已滿 2 秒 → 這次直接送(同一次呼叫裡可送的頻道仍一次 `/publish` 帶走)
 * - 2 秒內又來 → 不送,在窗尾補送一次(期間再來幾次都只補一次,帶最後一次的信號)
 *
 * 信號只是「有東西變了」的提醒,合併後收到的一方照樣重抓到最新資料;窗尾那一次保證最後一次變動不會漏。
 * 記錄只在本行程(Cloud Run 最多 2 台各自合併);補送靠計時器,行程被回收時可能晚到或不到 ——
 * 與信號本身一樣是盡力而為,斷線時前端的輪詢與重連補抓會補上。
 */
export class SignalCoalescer {
  private readonly lastSentAt = new Map<string, number>();
  private readonly trailing = new Map<string, Trailing>();

  constructor(
    private readonly flush: FlushSignal,
    private readonly clock: CoalescerClock = systemClock,
  ) {}

  submit(
    hub: string,
    topics: readonly string[],
    signal: RealtimeSignal,
  ): Promise<void> {
    const now = this.clock.now();
    this.sweep(now);
    const ready: string[] = [];
    for (const topic of topics) {
      const key = keyOf(hub, topic, signal.type);
      const last = this.lastSentAt.get(key);
      if (last === undefined || now - last >= SIGNAL_COALESCE_WINDOW_MS) {
        this.lastSentAt.set(key, now);
        ready.push(topic);
        continue;
      }
      const queued = this.trailing.get(key);
      this.trailing.set(key, { hub, topic, signal });
      if (queued === undefined) {
        this.clock.schedule(
          () => {
            void this.fireTrailing(key);
          },
          last + SIGNAL_COALESCE_WINDOW_MS - now,
        );
      }
    }
    return ready.length === 0
      ? Promise.resolve()
      : this.flush(hub, ready, signal);
  }

  private async fireTrailing(key: string): Promise<void> {
    const queued = this.trailing.get(key);
    if (queued === undefined) {
      return;
    }
    this.trailing.delete(key);
    this.lastSentAt.set(key, this.clock.now());
    await this.flush(queued.hub, [queued.topic], queued.signal);
  }

  private sweep(now: number): void {
    if (this.lastSentAt.size <= SWEEP_THRESHOLD) {
      return;
    }
    for (const [key, sentAt] of this.lastSentAt) {
      if (
        now - sentAt >= SIGNAL_COALESCE_WINDOW_MS &&
        !this.trailing.has(key)
      ) {
        this.lastSentAt.delete(key);
      }
    }
  }
}

function keyOf(hub: string, topic: string, type: string): string {
  return `${hub}\u0000${topic}\u0000${type}`;
}
