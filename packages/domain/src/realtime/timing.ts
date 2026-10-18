/**
 * 即時通道客戶端(admin 的 `RealtimeConnection`、代理程式的 `RealtimeLink`)共用的時間常數
 * (換發與斷線重連)。
 */

/** 到期前多久在原連線上換發(毫秒)。 */
export const RENEW_BEFORE_MS = 60_000;

/** 換發的最小間隔(毫秒):時間異常時也不會連續換發。 */
export const MIN_RENEW_DELAY_MS = 30_000;

/** 重連退避(毫秒):依連續失敗次數取,用完停在最後一個。 */
export const RECONNECT_BACKOFF_MS: readonly number[] = [
  1000, 2000, 5000, 10_000, 30_000,
];

/**
 * 偵測半開連線:連上後每隔這麼久送一次 `REALTIME_PING`(毫秒)。
 * 目前只有代理程式的 `RealtimeLink` 採用;admin 不採用的理由見 `apps/admin` 的 `RealtimeConnection`。
 */
export const REALTIME_PING_INTERVAL_MS = 30_000;

/** 送出 `REALTIME_PING` 後多久沒收到 `REALTIME_PONG` 就當連線壞了,關掉重連(毫秒)。 */
export const REALTIME_PONG_TIMEOUT_MS = 10_000;
