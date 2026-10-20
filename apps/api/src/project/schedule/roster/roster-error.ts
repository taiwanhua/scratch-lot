import { GraphQLError } from "graphql";

/**
 * 排班已被收銀班次綁定、不能刪(規格 14.5「[刪除這筆排班]」、14.9):`VALIDATION_FAILED`(欄位 `fields`),
 * `extensions.blockedEntryIds` 列出擋下的排班,畫面據此列出「要先改那筆排班」。
 */
export function entriesLockedError(
  blockedEntryIds: readonly string[],
  fields: string[],
): GraphQLError {
  return new GraphQLError("schedule entries are bound to cash shifts", {
    extensions: {
      code: "VALIDATION_FAILED",
      fields,
      blockedEntryIds: [...blockedEntryIds],
    },
  });
}
