import { useTranslations } from "use-intl";

import { useOrgManagersQuery } from "@repo/graphql";
import { Typography } from "@repo/ui/typography";

import { useSession } from "@/hooks/base/useSession";

import { OrgDetailRow } from "./OrgDetailRow";

export interface OrgManagersRowProps {
  orgId: string;
}

/**
 * 資料區的「主管」列(`org(id).managers`,獨立一支查詢 `OrgManagers`,不讓每次 `org(id)` 都多查一次)。
 * 名單照設定順序、以「、」串起來;停用的主管仍列出並標註(解析時不算,管理者要看得到才移得掉)。
 */
export const OrgManagersRow = ({ orgId }: OrgManagersRowProps) => {
  const t = useTranslations("admin.orgManager.detail");
  const { session } = useSession();
  const query = useOrgManagersQuery(session.client, { id: orgId });
  const managers = query.data?.org.managers ?? [];

  return (
    <OrgDetailRow label={t("managers")}>
      <Typography variant="body2">
        {managers.length === 0
          ? t("managersEmpty")
          : managers
              .map((manager) =>
                manager.enabled
                  ? manager.name
                  : t("managerDisabled", { name: manager.name }),
              )
              .join("、")}
      </Typography>
    </OrgDetailRow>
  );
};
