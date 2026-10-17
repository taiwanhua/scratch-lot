import { useMemo } from "react";
import { useTranslations } from "use-intl";

import type { AudienceField } from "@repo/domain/audience";
import { useOrgTreeQuery } from "@repo/graphql";

import { useSession } from "@/hooks/base/useSession";
import {
  type AudienceOrgSourceOption,
  toAudienceDraft,
} from "@/lib/base/audience-draft";
import { audienceSummaryOf } from "@/lib/base/audience-summary";
import { flattenOrgs } from "@/lib/base/org-tree";
import { permissionLabels } from "@/lib/base/permission-options";

import { useAudienceOptions } from "./useAudienceOptions";

/**
 * 人員條件 JSON → 一行白話摘要(`lib/base/audience-summary.ts`)。名稱借 AudiencePicker 的候選清單
 * (角色 / 使用者 / 權限樹)與 `orgTree`;解不出來的值顯示「不在候選清單中」,清單載入中顯示「載入中…」。
 * 動態組織來源的名稱由使用處的 `orgSources` 給(與編輯對話框同一份)。
 */
export const useAudienceSummary = (
  fields: readonly AudienceField[],
  orgSources: readonly AudienceOrgSourceOption[],
): ((audience: unknown) => string) => {
  const t = useTranslations("admin.audiencePicker");
  const { session } = useSession();
  const options = useAudienceOptions(fields);
  const orgTree = useOrgTreeQuery(session.client, undefined, {
    enabled: fields.includes("org"),
  });

  return useMemo(() => {
    const orgNames = new Map(
      flattenOrgs(orgTree.data?.orgTree ?? []).map((org) => [org.id, org.name]),
    );
    const permissions = permissionLabels(
      options.permissionModules,
      t("permissionWildcard"),
    );
    const roleNames = new Map(
      options.roles.map((role) => [role.id, role.name]),
    );
    const userNames = new Map(
      options.users.map((user) => [user.id, user.label]),
    );
    const isLoading: Record<AudienceField, boolean> = {
      user: options.isUsersLoading,
      role: options.isRolesLoading,
      org: orgTree.isLoading,
      permission: options.isPermissionsLoading,
    };
    const names: Record<AudienceField, ReadonlyMap<string, string>> = {
      user: userNames,
      role: roleNames,
      org: orgNames,
      permission: permissions,
    };
    const fallbackField = fields.at(0) ?? "role";
    const dynamicLabels = new Map(
      orgSources.flatMap((source) =>
        source.kind === "dynamic" ? [[source.ref, source.label] as const] : [],
      ),
    );
    return (audience: unknown) =>
      audienceSummaryOf(toAudienceDraft(audience, fallbackField, orgSources), {
        field: (field) => t(`fields.${field}`),
        cond: (field) => (field === "permission" ? t("condHold") : t("condIn")),
        and: t("summaryAnd"),
        or: t("summaryOr"),
        range: (range) => t(`ranges.${range}`),
        nameOf: (field, value) =>
          names[field].get(value) ??
          (isLoading[field] ? t("loading") : t("outOfList")),
        dynamicOf: (ref) => dynamicLabels.get(ref) ?? ref,
        unset: t("summaryUnset"),
      });
  }, [fields, orgSources, options, orgTree.data, orgTree.isLoading, t]);
};
