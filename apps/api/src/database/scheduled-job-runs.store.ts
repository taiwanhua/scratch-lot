/* eslint-disable @repo/no-raw-model-query -- 排程任務的執行紀錄不是租戶資料(沒有操作者、組織歸屬與基礎欄位),冪等靠唯一索引的插入衝突與條件式原子更新,BaseRepository 沒有這種語意;此檔是 `scheduled_job_runs` 唯一的讀寫出口;到期條件:無 */
import type { Model, Types } from "mongoose";

import { isDuplicateKeyError } from "../forms/forms-error";
import type {
  ScheduledJobRun,
  ScheduledJobRunStatus,
} from "./schemas/scheduled-job-run.schema";

/** 錯誤訊息最多存這麼長(堆疊不存,完整內容看 log)。 */
const MAX_ERROR_LENGTH = 2000;

/**
 * `running` 超過這麼久視為卡住(執行它的 instance 已當掉,或被 Cloud Run 的 300 秒請求逾時中止),
 * 之後的呼叫可重新取得。必須大於請求逾時,否則還在跑的工作會被重複執行。
 */
export const STALE_RUNNING_MS = 15 * 60 * 1000;

/**
 * `scheduled_job_runs` 的讀寫出口(`docs/data-model.md`「排程任務執行紀錄」)。
 * 「取得某工作某時點的執行權」= 插入一筆 `running`;唯一 `(key, scheduledFor)` 讓同一時點只有一個呼叫者插得進去。
 */
export class ScheduledJobRunsStore {
  constructor(private readonly model: Model<ScheduledJobRun>) {}

  /**
   * 取得 `(key, scheduledFor)` 的執行權:成功回這筆紀錄的 id;該時點已有紀錄回 null。
   * 例外是卡住的 `running`(`startedAt` 早於 `STALE_RUNNING_MS`):以條件式原子更新改寫 `startedAt` 重新取得;
   * 條件含舊的 `startedAt` 範圍,兩個呼叫者同時搶時只有一個更新得到。
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
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
    const reclaimed = await this.model
      .findOneAndUpdate(
        {
          key,
          scheduledFor,
          status: "running",
          startedAt: { $lt: new Date(startedAt.getTime() - STALE_RUNNING_MS) },
        },
        { $set: { startedAt, finishedAt: null, error: null } },
        { new: true },
      )
      .lean<{ _id: Types.ObjectId }>()
      .exec();
    return reclaimed?._id ?? null;
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
