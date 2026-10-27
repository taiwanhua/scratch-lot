import { useState } from "react";
import { useTranslations } from "use-intl";

import { Alert } from "@repo/ui/alert";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import { Pagination } from "@repo/ui/pagination";
import { Stack } from "@repo/ui/stack";
import { Table, type TableColumn } from "@repo/ui/table";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { ORG_MEMBERS_PAGE_SIZE, type OrgMemberRow } from "../org-manager-types";
import { AddMembersDialog } from "./AddMembersDialog";
import { useOrgMembers } from "./useOrgMembers";

export interface MembersTabProps {
  orgId: string;
  orgName: string;
  /** 持 `system.org-manager.add-members` 才給「加入成員」(ADR-0011「頁內判斷」) */
  canAdd: boolean;
}

/**
 * 組織詳情的「成員」頁籤:成員表 + 加入成員。
 *
 * 清單是**這個組織自己的成員**,不含下層組織的成員(org-manager.md「api 介面」)——
 * 「加入成員」加的就是一筆直接關聯,列表要跟它對得起來。
 * **沒有「移除」**:移除所屬組織會牽動失去資格的角色與 dry-run 三檔(ADR-0003),
 * 入口維持使用者管理的「選擇所屬組織」一處。
 */
export const MembersTab = ({ orgId, orgName, canAdd }: MembersTabProps) => {
  const t = useTranslations("admin.orgManager.members");
  const tErrors = useTranslations("admin.orgManager.errors");
  const [isAdding, setIsAdding] = useState(false);
  const data = useOrgMembers(orgId, () => {
    setIsAdding(false);
  });

  const pageCount = Math.max(
    1,
    Math.ceil(data.totalCount / ORG_MEMBERS_PAGE_SIZE),
  );

  const columns: TableColumn<OrgMemberRow>[] = [
    {
      key: "name",
      header: t("columns.name"),
      isEmphasized: true,
      render: (row) => row.name,
    },
    {
      key: "account",
      header: t("columns.account"),
      render: (row) => row.account,
    },
    {
      key: "enabled",
      header: t("columns.status"),
      render: (row) => (
        <Tag
          tone={row.enabled ? "success" : "error"}
          label={row.enabled ? t("enabled") : t("disabled")}
        />
      ),
    },
    {
      key: "otherOrgs",
      header: t("columns.otherOrgs"),
      render: (row) =>
        row.otherOrgs.length === 0
          ? t("none")
          : row.otherOrgs.map((org) => org.name).join("、"),
    },
  ];

  return (
    <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1">
            {t("title", { name: orgName })}
          </Typography>
          <Typography variant="caption" color="textSecondary" component="p">
            {t("hint")}
          </Typography>
        </Box>
        {canAdd && (
          <Button
            onClick={() => {
              data.clearError();
              setIsAdding(true);
            }}
          >
            {t("add")}
          </Button>
        )}
      </Stack>

      {data.errorCode !== null && !isAdding && (
        <Alert severity="error">{tErrors(data.errorCode)}</Alert>
      )}

      {/* 捲動責任在 Table 自己的容器:這層只把剩下的高度給它,不再自己捲 */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Table
          columns={columns}
          rows={data.rows}
          getRowKey={(row) => row.id}
          isLoading={data.isLoading}
          emptyMessage={t("empty")}
          // 四個欄位,「其他所屬組織」要放得下多個組織名(STYLE-11)
          minWidth={640}
          aria-label={t("tableLabel")}
        />
      </Box>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
          {t("total", {
            total: data.totalCount,
            pageSize: ORG_MEMBERS_PAGE_SIZE,
          })}
        </Typography>
        <Pagination
          count={pageCount}
          page={data.page}
          onChange={(_event, nextPage) => {
            data.setPage(nextPage);
          }}
        />
      </Stack>

      {isAdding && (
        <AddMembersDialog
          orgId={orgId}
          orgName={orgName}
          isSubmitting={data.isSubmitting}
          errorCode={data.errorCode}
          onCancel={() => {
            data.clearError();
            setIsAdding(false);
          }}
          onConfirm={data.add}
        />
      )}
    </Stack>
  );
};
