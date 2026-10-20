import { randomBytes } from "node:crypto";

/**
 * 可指定種子的亂數產生器(規格 14.5「隨機:用可指定種子的產生器」):同一個種子一定產生同一串數字,
 * 自動排班把種子記在執行紀錄,之後可以用同一個種子重現同一次結果(追查、測試)。
 *
 * 演算法是 mulberry32(32 位元狀態;不是密碼學用途,只要分佈均勻、可重現)。
 * **改演算法 = 改自動排班的演算法版本**(`SCHEDULE_AUTO_RUN_ALGORITHM_VERSION`)。
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 系統產生的種子(32 位元正整數;使用者看不到也不能操作)。 */
export function newAutoRunSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}
