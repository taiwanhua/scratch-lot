import { RESCAN_REASONS } from "@repo/domain/project/lottery";
import { ClientError } from "@repo/graphql";

/**
 * 全店重刷的業務錯誤(GQL-04 的 `extensions.reason`;正本 `docs/modules/project/store.md`「錯誤碼」):
 * 這個位置有人盤點中(誰、幾點開始、剩幾分鐘)/ 別人正在刷(誰)/ 已刷完 / 重刷已結束 / 找不到張 /
 * 開始被擋(這個遊戲已在重刷中、補點編號中)/ 不是張數店。不是這幾種 → `reason: null`。
 */
export interface RescanError {
  reason: string | null;
  byName: string;
  startedAt: string | null;
  minutesLeft: number;
  /** `RESCAN_START_BLOCKED`:`rescan` / `renumber` */
  block: string | null;
}

const KNOWN: readonly string[] = Object.values(RESCAN_REASONS);

export const rescanErrorOf = (error: unknown): RescanError => {
  const extensions =
    error instanceof ClientError
      ? ((
          error.response as {
            errors?: { extensions?: Record<string, unknown> }[];
          }
        ).errors?.[0]?.extensions ?? {})
      : {};
  const reason =
    typeof extensions.reason === "string" && KNOWN.includes(extensions.reason)
      ? extensions.reason
      : null;
  return {
    reason,
    byName: typeof extensions.byName === "string" ? extensions.byName : "",
    startedAt:
      typeof extensions.startedAt === "string" ? extensions.startedAt : null,
    minutesLeft:
      typeof extensions.minutesLeft === "number" ? extensions.minutesLeft : 0,
    block: typeof extensions.block === "string" ? extensions.block : null,
  };
};
