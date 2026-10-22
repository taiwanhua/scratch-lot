import {
  DEFAULT_TENANT_TIMEZONE,
  parseLocalDate,
  startOfLocalDay,
} from "@repo/domain/form";

import type { GraphqlClient } from "../../../src/demo/graphql-client";

const TIMEZONE = /* GraphQL */ `
  query OnboardingTimezone {
    me {
      currentOrg {
        timezone
      }
    }
  }
`;

/**
 * 日期(`YYYY-MM-DD`)→ 租戶時區那一天 00:00 的時點(ISO 字串;api 只收時點,同 admin 送日期欄的做法)。
 * 租戶時區以登入者目前的組織讀一次;日期不合法 → 丟錯。
 */
export async function tenantDayInstants(
  client: GraphqlClient,
): Promise<(text: string) => string> {
  const { me } = await client.request<{
    me: { currentOrg: { timezone: string } | null };
  }>(TIMEZONE);
  const timezone = me.currentOrg?.timezone ?? DEFAULT_TENANT_TIMEZONE;
  return (text) => {
    const date = parseLocalDate(text);
    if (date === null) {
      throw new Error(`日期不合法:${text}`);
    }
    return new Date(startOfLocalDay(date, timezone)).toISOString();
  };
}
