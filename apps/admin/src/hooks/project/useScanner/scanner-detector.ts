/**
 * 條碼槍判斷(專案規格 18.3「判斷」):條碼槍是鍵盤輸入 —— 字元間隔小於門檻、長度符合、以 Enter 結尾
 * → 視為掃描。門檻是**程式常數**(不放租戶設定或個人偏好),收到條碼槍實測後改這裡。
 */

/** 條碼槍兩個字元之間的間隔上限(毫秒,含;規格 18.3、Spec #104 第 5 節第 6 條)。 */
export const SCANNER_KEY_INTERVAL_MS = 30;

/** 視為掃描的最短長度(正面編號 9 碼、正面條碼 10 碼、背面編號 21 碼都超過)。 */
export const SCANNER_MIN_LENGTH = 6;

/** 一次掃描的結果:讀到的碼。 */
export interface DetectedScan {
  code: string;
}

/**
 * 依序餵入按鍵,回答「這個 Enter 是不是一次掃描的結尾」。只看可列印的單一字元與 Enter;
 * 與上一個字元的間隔超過門檻 → 從這個字元重新開始累積(人工打字)。
 */
export class ScannerDetector {
  private buffer = "";
  private lastAt: number | null = null;

  /** 目前累積的是不是「剛開始的一段」(第一個字元;呼叫端在這時記下輸入框原值)。 */
  get isFresh(): boolean {
    return this.buffer.length === 1;
  }

  /**
   * 餵一個按鍵;`key` 是 `KeyboardEvent.key`,`at` 是毫秒時間。
   * 回 `DetectedScan` = 這個 Enter 結束了一次掃描;其他情況回 null。
   */
  feed(key: string, at: number): DetectedScan | null {
    const gap =
      this.lastAt === null ? Number.POSITIVE_INFINITY : at - this.lastAt;
    const fast = gap <= SCANNER_KEY_INTERVAL_MS;
    if (key === "Enter") {
      const code = this.buffer;
      this.reset();
      return fast && code.length >= SCANNER_MIN_LENGTH ? { code } : null;
    }
    if (key.length !== 1) {
      // Shift 之類的修飾鍵不算字元,也不中斷
      return null;
    }
    this.buffer = fast ? this.buffer + key : key;
    this.lastAt = at;
    return null;
  }

  reset(): void {
    this.buffer = "";
    this.lastAt = null;
  }
}
