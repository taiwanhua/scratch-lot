/* eslint-disable @repo/no-raw-model-query -- 排程任務的執行紀錄不是租戶資料(沒有操作者、組織歸屬與基礎欄位),冪等靠唯一索引的插入衝突,BaseRepository 沒有這種語意;此檔是 `scheduled_job_runs` 唯一的讀寫出口;到期條件:無 */
import type { Model, Types } from "mongoose";

import type {
  ScheduledJobRun,
  ScheduledJobRunStatus,
} from "./schemas/scheduled-job-run.schema";

/** 錯誤訊息最多存這麼長(堆疊不存,完整內容看 log)。 */
const MAX_ERROR_LENGTH = 2000;

/** Mongo 唯一索引衝突(E11000)。 */
function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11_000
  );
}

/**
 * `scheduled_job_runs` 的讀寫出口(`docs/data-model.md`「排程任務執行紀錄」)。
 * 「取得某工作某時點的執行權」= 插入一筆 `running`;唯一 `(key, scheduledFor)` 讓同一時點只有一個呼叫者插得進去。
 */
export class ScheduledJobRunsStore {
  constructor(private readonly model: Model<ScheduledJobRun>) {}

  /**
   * 取得 `(key, scheduledFor)` 的執行權:成功回這筆紀錄的 id;該時點已有紀錄(任何狀態)回 null。
   * 先等唯一索引建好再插入:新部署第一次被呼叫時,autoIndex 可能還在建,不等就擋不住重複。
   */
  async claim(
    key: string,
    scheduledFor: Date,
    startedAt: Date,
  ): Promise<Types.ObjectId | null> {
    await this.model.init();
    try {
      const created = await this.model.create({
        key,
        scheduledFor,
        status: "running",
        startedAt,
        finishedAt: null,
        error: null,
      });
      return created._id;
    } catch (error) {
      if (isDuplicateKey(error)) {
        return null;
      }
      throw error;
    }
  }

  /** 記錄執行結果。 */
  async finish(
    id: Types.ObjectId,
    status: Exclude<ScheduledJobRunStatus, "running">,
    finishedAt: Date,
    error: string | null = null,
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: id },
        {
          $set: {
            status,
            finishedAt,
            error: error === null ? null : error.slice(0, MAX_ERROR_LENGTH),
          },
        },
      )
      .exec();
  }
}
