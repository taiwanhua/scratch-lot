import { GraphQLError } from "graphql";

import { STOCKTAKE_REASONS } from "@repo/domain/project/lottery";

/**
 * 盤點的業務錯誤(GQL-04):只用通用碼 `NOT_FOUND` / `VALIDATION_FAILED` / `FORBIDDEN` / `CONFLICT`,
 * 細分原因放 `extensions.reason`(`STOCKTAKE_REASONS`;正本 `docs/modules/project/store.md`「錯誤碼」)。
 */
export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export function forbiddenError(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN", reason: STOCKTAKE_REASONS.forbidden },
  });
}

export function validationError(
  message: string,
  fields: string[],
  reason?: string,
  extra: Record<string, unknown> = {},
): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "VALIDATION_FAILED",
      fields,
      ...(reason === undefined ? {} : { reason }),
      ...extra,
    },
  });
}

/** 補登售出 / 送出時:這幾張已被處理(請重新核對);`tickets` = 張 id。 */
export function alreadyProcessedError(
  tickets: readonly string[],
): GraphQLError {
  return new GraphQLError("these tickets were already processed", {
    extensions: {
      code: "CONFLICT",
      reason: STOCKTAKE_REASONS.alreadyProcessed,
      tickets: [...tickets],
    },
  });
}
