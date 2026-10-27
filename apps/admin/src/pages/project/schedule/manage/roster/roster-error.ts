import { ClientError } from "@repo/graphql";

/**
 * 排班已被收銀班次綁定、不能刪時 api 帶回的排班 id(`extensions.blockedEntryIds`;
 * api 正本 `apps/api/src/project/schedule/roster/roster-error.ts`)。不是這種錯誤回空陣列。
 */
export const blockedEntryIdsOf = (error: unknown): string[] => {
  if (!(error instanceof ClientError)) {
    return [];
  }
  const { errors } = error.response as {
    errors?: { extensions?: { blockedEntryIds?: unknown } }[];
  };
  const ids = errors?.[0]?.extensions?.blockedEntryIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];
};

/** api 標回的欄位(`extensions.fields`)。 */
export const errorFieldsOf = (error: unknown): string[] => {
  if (!(error instanceof ClientError)) {
    return [];
  }
  const { errors } = error.response as {
    errors?: { extensions?: { fields?: unknown } }[];
  };
  const fields = errors?.[0]?.extensions?.fields;
  return Array.isArray(fields)
    ? fields.filter((field): field is string => typeof field === "string")
    : [];
};
