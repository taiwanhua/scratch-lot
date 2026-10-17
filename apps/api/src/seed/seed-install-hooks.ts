import { Injectable } from "@nestjs/common";

/**
 * 安裝一筆定義時、每一個寫入**之前**的檢查點名稱(依寫入順序):
 * - `reserve`:登記安裝紀錄(第一筆身分 / 版本寫入之前)
 * - `create-identity`:建表單 / 流程身分
 * - `update-metadata`:條件更新名稱 / 頁籤模板
 * - `create-draft`:建預配置 id 的草稿
 * - `save-draft`:把宣告的定義存進草稿
 * - `publish`:發布(其中每一筆寫入另有原生命週期自己的檢查點)
 * - `retire`:明示退役
 * - `record-installed`:實體都核對過,記成功之前
 */
export type SeedInstallCheckpoint =
  | "reserve"
  | "create-identity"
  | "update-metadata"
  | "create-draft"
  | "save-draft"
  | "publish"
  | "retire"
  | "record-installed";

/**
 * 安裝流程的檢查點(正式環境只記下來就放行)。
 *
 * 為什麼有它:安裝沿用原服務,每個原服務動作各自是一個交易,但整次安裝不包成單一交易;一致性靠「任何一步失敗
 * 都停在那一步之前,重跑以安裝紀錄預先配好的 id 接續」。要驗「每個中斷點重跑後都只有一個正式版本」,測試必須能讓指定的那一步**真的**在
 * 半路失敗 —— 同 `FormPublishHooks` 的理由(TEST-07 的第二個接縫),測試以 spy 在這裡丟錯。
 */
@Injectable()
export class SeedInstallHooks {
  private last: SeedInstallCheckpoint | null = null;

  /** 最後走到的檢查點(除錯用)。 */
  get lastCheckpoint(): SeedInstallCheckpoint | null {
    return this.last;
  }

  reached(checkpoint: SeedInstallCheckpoint): Promise<void> {
    this.last = checkpoint;
    return Promise.resolve();
  }
}
