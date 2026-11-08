import { afterAll, beforeAll, jest } from "@jest/globals";

/**
 * 測試的假「現在」(TEST-13)。
 *
 * api 寫入時有些時間取 `new Date()`(建立時間、進貨 / 調貨事件、鎖的時間),有些取注入的時鐘
 * (`StoreClock` / `ScheduleClock`)。只假時鐘、不假 `Date`,兩條時間軸就會隨跑測試的日子錯開
 * (例:時鐘固定 11/05,真實時間過了 11/05 後,前置的進貨事件排到售出事件之後)。
 * `useFakeNow` 把 `Date` 也一起假掉,整個 describe 只有一條時間軸。
 */

/** 只假 `Date`:計時器、microtask、hrtime 照真的走(Nest、MongoDB driver、supertest 不受影響)。 */
const REAL_TIMER_APIS = [
  "hrtime",
  "nextTick",
  "performance",
  "queueMicrotask",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "setImmediate",
  "clearImmediate",
  "setInterval",
  "clearInterval",
  "setTimeout",
  "clearTimeout",
] as const;

/**
 * 整個 describe 的 `Date` 從 `start` 起算、照真實速度往前走:前置資料、api 的 `new Date()`、
 * 注入的時鐘(預設實作就是 `new Date()`)都在同一條時間軸上。
 * 要在 describe 裡**最先**呼叫(排在開 app、建前置資料的 `beforeAll` 之前)。
 *
 * 讀有 TTL 索引的集合(通知、refresh token)的測試不要用:MongoDB 用真實時間清 TTL,
 * 假的建立時間早於真實時間太多時,資料會在測試中途被刪掉。
 */
export const useFakeNow = (start: Date): void => {
  beforeAll(() => {
    jest.useFakeTimers({
      now: start,
      advanceTimers: true,
      doNotFake: [...REAL_TIMER_APIS],
    });
  });
  afterAll(() => {
    jest.useRealTimers();
  });
};
