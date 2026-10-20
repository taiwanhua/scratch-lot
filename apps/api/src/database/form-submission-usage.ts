/* eslint-disable @repo/no-raw-model-query -- 退役權限清理的跨租戶計數:必須數到**全部**租戶的提交(含操作者可見範圍 / 資料範圍規則之外的),少算就會把還有草稿在用的權限刪掉;只回計數、不回任何提交內容;到期條件:無 */
import type { Model } from "mongoose";

import { markCrossTenantAggregate } from "./operator-context";
import type { FormSubmission } from "./schemas/form-submission.schema";

/**
 * 某張表單的某幾個版本,被多少提交用到(依狀態分)。一筆提交「用到」某版本 = 目前綁的 `version` 是它,
 * 或任一修訂的 `revisions[].version` 是它(升級過的單,舊修訂仍以舊版定義渲染,舊版的欄位還在被讀)。
 * 計數是**提交筆數**:一筆提交同時用到多個被問的版本也只算一次。
 */
export interface FormSubmissionUsage {
  /** 還在填 / 還在審(草稿、審核中、被退回、已撤回):有任何一筆就擋下刪除。 */
  draftCount: number;
  draftVersions: number[];
  /** 只剩歷史提交(已完成、已駁回、已作廢,內容不會再改):要使用者確認才刪。 */
  completedCount: number;
  completedVersions: number[];
}

/** 終局、內容不會再改的狀態:與已完成同一層,警告確認後可刪。 */
const HISTORICAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "rejected",
  "voided",
]);

/** 依(狀態, 這筆提交用到的被問版本集合)分組的筆數。 */
interface UsageRow {
  _id: { status: string; versions: number[] };
  count: number;
}

/**
 * 退役權限清理的三層檢查要的計數。
 *
 * 為什麼不經 `BaseRepository`:那一層一定套可見範圍與資料範圍規則(ADR-0005 / ADR-0008),
 * 這裡的判斷卻必須 fail-closed —— 任何一筆沒被數到的草稿都會讓權限被誤刪、那一欄就只剩 root 看得到。
 * 所以直接對 collection 聚合,只回數字與版本號,不把任何一筆提交交給呼叫端。
 */
export class FormSubmissionUsageCounter {
  constructor(private readonly model: Model<FormSubmission>) {}

  async usageOf(
    formKey: string,
    versions: readonly number[],
  ): Promise<FormSubmissionUsage> {
    const usage: FormSubmissionUsage = {
      draftCount: 0,
      draftVersions: [],
      completedCount: 0,
      completedVersions: [],
    };
    if (versions.length === 0) {
      return usage;
    }
    const asked = [...versions];
    // 標記為登記過的跨租戶出口:tenantScopePlugin 的 aggregate 中介層對未帶上下文的 aggregate 一律拋錯
    const rows = await markCrossTenantAggregate(
      this.model.aggregate<UsageRow>([
        {
          $match: {
            formKey,
            deletedAt: null,
            $or: [
              { version: { $in: asked } },
              { "revisions.version": { $in: asked } },
            ],
          },
        },
        {
          // 這筆提交用到的版本 = 目前的 version ∪ 各修訂的 version(沒寫的修訂 = 目前的 version),
          // 取與被問版本的交集;$setUnion 去重,同一筆對同一版本只算一次
          $project: {
            status: 1,
            versions: {
              $setIntersection: [
                {
                  $setUnion: [
                    ["$version"],
                    { $ifNull: ["$revisions.version", []] },
                  ],
                },
                asked,
              ],
            },
          },
        },
        {
          $group: {
            _id: { status: "$status", versions: "$versions" },
            count: { $sum: 1 },
          },
        },
      ]),
    ).exec();
    const drafts = new Set<number>();
    const completed = new Set<number>();
    for (const row of rows) {
      const isHistorical = HISTORICAL_STATUSES.has(row._id.status);
      // 草稿 / 審核中 / 被退回 / 已撤回都還會再寫:擋下;已完成 / 已駁回 / 已作廢:確認後可刪
      if (isHistorical) {
        usage.completedCount += row.count;
      } else {
        usage.draftCount += row.count;
      }
      for (const version of row._id.versions) {
        (isHistorical ? completed : drafts).add(version);
      }
    }
    usage.draftVersions = [...drafts].toSorted((a, b) => a - b);
    usage.completedVersions = [...completed].toSorted((a, b) => a - b);
    return usage;
  }
}
