import { GraphQLError } from "graphql";

import { CHECKOUT_REASONS } from "@repo/domain/project/lottery";

/**
 * 交班結帳的業務錯誤(GQL-04):只用通用碼 `NOT_FOUND` / `VALIDATION_FAILED` / `FORBIDDEN` / `CONFLICT`,
 * 細分原因放 `extensions.reason`(`CHECKOUT_REASONS`;正本 `docs/modules/project/store.md`「錯誤碼」)。
 */
export function notFoundError(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export function forbiddenError(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN", reason: CHECKOUT_REASONS.forbidden },
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

/** 資料在這段時間被改了 / 讀不到(例:送出時班次已不存在)。 */
export function conflictError(message: string, reason?: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: {
      code: "CONFLICT",
      ...(reason === undefined ? {} : { reason }),
    },
  });
}
