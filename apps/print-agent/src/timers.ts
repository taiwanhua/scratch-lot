/** 計時器介面:正式用 Node 的 setTimeout,測試注入可手動推進的版本(不靠真實時間)。 */
export interface Timers {
  now(): number;
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export const systemTimers: Timers = {
  now: () => Date.now(),
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export function sleep(timers: Timers, delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    timers.set(resolve, delayMs);
  });
}
