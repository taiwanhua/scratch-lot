import type { RealtimeSignal } from "@repo/domain/realtime";

/** 高頻信號(看板)同一頻道每 2 秒最多送一次(底座規格第 4 章「頻道」)。 */
export const SIGNAL_COALESCE_WINDOW_MS = 2000;

/** 要合併的信號類型:只有看板。`badge:*`、`notification` 等一律照送。 */
export const COALESCED_SIGNAL_TYPES: ReadonlySet<string> = new Set(["board"]);

/** 清掉過期紀錄的門檻:記錄數超過它才掃一次,平常不掃。 */
const SWEEP_THRESHOLD = 1000;

/**
 * 送出端的高頻信號合併:只對 `COALESCED_SIGNAL_TYPES`(看板),以「租戶 + 頻道 + 類型」為單位,
 * **前緣立即送、2 秒窗內的丟棄**;伺服器不排計時器補送(Cloud Run 請求外 CPU 會被節流,計時器不可靠)。
 *
 * 窗內被丟掉的最後一次變動,由收到前緣信號的瀏覽器在約 2.5 秒後再重抓一次補上
 * (`RealtimeProvider`),所以畫面最終一定是最新資料。記錄只在本行程(Cloud Run 最多 2 台各自合併)。
 */
export class SignalCoalescer {
  private readonly lastSentAt = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** 這次送出中真正要送的頻道(不合併的類型全部照送)。 */
  select(
    hub: string,
    topics: readonly string[],
    signal: RealtimeSignal,
  ): string[] {
    if (!COALESCED_SIGNAL_TYPES.has(signal.type)) {
      return [...topics];
    }
    const now = this.now();
    this.sweep(now);
    return topics.filter((topic) => {
      const key = `${hub}\u0000${topic}\u0000${signal.type}`;
      const last = this.lastSentAt.get(key);
      if (last !== undefined && now - last < SIGNAL_COALESCE_WINDOW_MS) {
        return false;
      }
      this.lastSentAt.set(key, now);
      return true;
    });
  }

  private sweep(now: number): void {
    if (this.lastSentAt.size <= SWEEP_THRESHOLD) {
      return;
    }
    for (const [key, sentAt] of this.lastSentAt) {
      if (now - sentAt >= SIGNAL_COALESCE_WINDOW_MS) {
        this.lastSentAt.delete(key);
      }
    }
  }
}
