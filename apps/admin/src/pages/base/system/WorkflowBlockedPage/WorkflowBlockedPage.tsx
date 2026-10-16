import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  BlockedInstancesFilter,
  type WorkflowInstanceFieldsFragment,
  useBlockedInstancesQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Card } from "@repo/ui/card";
import { Pagination } from "@repo/ui/pagination";
import { Stack } from "@repo/ui/stack";
import { Table } from "@repo/ui/table";
import { Tabs } from "@repo/ui/tabs";
import { Typography } from "@repo/ui/typography";

import { RetryAdvanceButton } from "@/components/base/workflow/ApprovalSection/RetryAdvanceButton";
import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";

import { WORKFLOWS_MODULE_KEY } from "../workflows-permissions";
import { AssignUserDialog } from "./AssignUserDialog";
import { type BlockedItem, blockedItemsOf } from "./blocked-items";
import { useBlockedActions } from "./useBlockedActions";

const PAGE_SIZE = 20;

type Row = WorkflowInstanceFieldsFragment;

/** 頁籤值(字串)→ 篩選列舉。 */
const FILTERS = new Map<string, BlockedInstancesFilter>(
  Object.values(BlockedInstancesFilter).map((value) => [value, value]),
);

interface Handling {
  instance: Row;
  item: BlockedItem;
}

/**
 * 阻擋清單(隱藏頁 `system.workflows.blocked-page`,Spec 6b §8 畫面 6;權限
 * `system.workflows.blocked-page.reassign`):
 *
 * - 篩選「阻擋」(找不到審核者 / 審核者失效)與「需要推進」(中斷、投影不同步…,判斷表對候選實例 dry-run;
 *   候選超過上限時只檢查了最久沒動的那一批,`truncated` 時提示)
 * - 每列:表單、實例上的標題槽(不含提交內容)、申請人、卡在哪一關、卡在誰、最後變動(讀者的租戶時區)
 * - 處置:改派(失效或還在等的人)、新增審核者(解析為空的關卡)、重試推進(冪等)
 */
export const WorkflowBlockedPage = () => {
  const t = useTranslations("admin.workflows.blocked");
  const temporalText = useTemporalText();
  const navigate = useNavigate();
  const routeOf = useModuleRoutes();
  const { session } = useSession();
  const [filter, setFilter] = useState<BlockedInstancesFilter>(
    BlockedInstancesFilter.Blocked,
  );
  const [page, setPage] = useState(1);
  const [handling, setHandling] = useState<Handling | null>(null);
  const actions = useBlockedActions();
  const query = useBlockedInstancesQuery(session.client, {
    input: { filter, page, pageSize: PAGE_SIZE },
  });
  const payload = query.data?.blockedInstances;
  const rows = payload?.items ?? [];
  const workflowsRoute = routeOf(WORKFLOWS_MODULE_KEY);

  const itemText = (item: BlockedItem): string => {
    if (item.kind === "empty") {
      return t("noAssignee", { step: item.stepName });
    }
    const key = item.isInvalid ? "invalidAssignee" : "waitingAssignee";
    return t(key, { step: item.stepName, name: item.assigneeName });
  };

  const renderItems = (row: Row) => {
    const items = blockedItemsOf(row);
    return (
      <Stack spacing={0.5}>
        {items.length === 0 && <Typography variant="body2">—</Typography>}
        {items.map((item) => (
          <Stack
            key={item.kind === "task" ? item.taskKey : `${item.stepKey}-empty`}
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography variant="body2">{itemText(item)}</Typography>
            {(item.kind === "empty" || item.taskId !== null) && (
              <Button
                size="small"
                variant="text"
                onClick={() => {
                  actions.clearError();
                  setHandling({ instance: row, item });
                }}
              >
                {item.kind === "empty" ? t("add") : t("reassign")}
              </Button>
            )}
          </Stack>
        ))}
      </Stack>
    );
  };

  return (
    <Card
      sx={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        px: 3,
        py: 2,
      }}
    >
      <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Typography variant="h6" component="h1" sx={{ flex: 1 }}>
            {t("title")}
          </Typography>
          {workflowsRoute !== null && (
            <Button
              variant="text"
              onClick={() => {
                void navigate(workflowsRoute);
              }}
            >
              {t("back")}
            </Button>
          )}
        </Stack>
        <Tabs
          aria-label={t("filters")}
          value={filter}
          onChange={(next) => {
            setFilter(FILTERS.get(next) ?? BlockedInstancesFilter.Blocked);
            setPage(1);
          }}
          items={[
            {
              value: BlockedInstancesFilter.Blocked,
              label: t("filterBlocked"),
            },
            {
              value: BlockedInstancesFilter.NeedsAdvance,
              label: t("filterNeedsAdvance"),
            },
          ]}
        />
        {payload?.truncated === true && (
          <Alert severity="info">{t("truncated")}</Alert>
        )}
        <Table<Row>
          aria-label={t("tableAria")}
          size="small"
          minWidth={960}
          rows={rows}
          getRowKey={(row) => row.id}
          isLoading={query.isLoading}
          emptyMessage={
            filter === BlockedInstancesFilter.Blocked
              ? t("emptyBlocked")
              : t("emptyNeedsAdvance")
          }
          columns={[
            {
              key: "form",
              header: t("form"),
              render: (row) => row.formName ?? row.formKey,
            },
            {
              key: "title",
              header: t("titleColumn"),
              isEmphasized: true,
              render: (row) => row.summary?.title ?? "—",
            },
            {
              key: "applicant",
              header: t("applicant"),
              render: (row) => row.applicant?.name ?? "—",
            },
            {
              key: "stuck",
              header: t("stuck"),
              render: (row) => renderItems(row),
            },
            {
              key: "since",
              header: t("since"),
              render: (row) => temporalText(row.updatedAt, "datetime"),
            },
            {
              key: "actions",
              header: t("actions"),
              render: (row) => (
                <RetryAdvanceButton
                  instanceId={row.id}
                  onDone={() => {
                    actions.refresh(row.id);
                  }}
                />
              ),
            },
          ]}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {t("total", { total: payload?.totalCount ?? 0 })}
          </Typography>
          <Pagination
            count={Math.max(
              1,
              Math.ceil((payload?.totalCount ?? 0) / PAGE_SIZE),
            )}
            page={page}
            onChange={(_event, next) => {
              setPage(next);
            }}
          />
        </Stack>
      </Stack>
      {handling !== null && (
        <AssignUserDialog
          mode={handling.item.kind === "empty" ? "add" : "reassign"}
          stepName={handling.item.stepName}
          {...(handling.item.kind === "task" && {
            fromName: handling.item.assigneeName,
          })}
          applicantId={handling.instance.applicant?.id ?? null}
          stepAssigneeIds={
            handling.item.kind === "task" ? handling.item.stepAssigneeIds : []
          }
          isSubmitting={actions.isPending}
          errorMessage={actions.errorMessage}
          onCancel={() => {
            setHandling(null);
          }}
          onConfirm={(userId) => {
            const { instance, item } = handling;
            const done =
              item.kind === "empty"
                ? actions.addAssignee(instance.id, item.stepKey, userId)
                : actions.reassign(instance.id, item.taskId ?? "", userId);
            void done.then((isDone) => {
              if (isDone) {
                setHandling(null);
              }
            });
          }}
        />
      )}
    </Card>
  );
};
