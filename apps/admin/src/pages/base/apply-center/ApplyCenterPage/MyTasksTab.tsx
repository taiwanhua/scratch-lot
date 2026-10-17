import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";

import {
  WorkflowBatchApproveFailure,
  type WorkflowTaskFieldsFragment,
  WorkflowTaskStatus,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Button } from "@repo/ui/button";
import {
  DataTable,
  type DataTableColumn,
  type DataTableRowSelection,
} from "@repo/ui/data-table";
import { SelectField } from "@repo/ui/select-field";
import { Stack } from "@repo/ui/stack";
import { Tag, type TagTone } from "@repo/ui/tag";

import { useWorkflowCache } from "@/components/base/workflow/useWorkflowCache";
import type { ApplicableModule } from "@/hooks/base/useApplicableForms";
import { useModuleRoutes } from "@/hooks/base/useModuleRoutes";
import { useMyTasks } from "@/hooks/base/useMyTasks";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { useUrlState } from "@/hooks/base/useUrlState";

import { APPLY_CENTER_VIEW_PAGE_KEY } from "../apply-center-keys";
import { ApplyCenterFilters } from "./ApplyCenterFilters";
import { BatchApproveDialog } from "./BatchApproveDialog";
import { TablePager } from "./TablePager";
import {
  APPLY_CENTER_LIST_KEY,
  type DoneFilter,
  myTasksListSchema,
} from "./apply-center-list";

const PAGE_SIZE = 20;

/** 批次核准一次最多勾幾筆(同 api 的 `BATCH_APPROVE_LIMIT`;底座規格 3.10 B18)。 */
const BATCH_APPROVE_LIMIT = 50;

const TASK_TONE: Record<WorkflowTaskStatus, TagTone> = {
  [WorkflowTaskStatus.Pending]: "primary",
  [WorkflowTaskStatus.Approved]: "success",
  [WorkflowTaskStatus.Rejected]: "error",
  [WorkflowTaskStatus.Returned]: "warning",
  [WorkflowTaskStatus.Late]: "grey",
  [WorkflowTaskStatus.Cancelled]: "grey",
  [WorkflowTaskStatus.Blocked]: "warning",
};

export interface MyTasksTabProps {
  modules: readonly ApplicableModule[];
}

/**
 * 「待我審核」(Spec 6b §8 畫面 8):模組、表單、實例快照的標題槽、申請人、關卡、建立時間;
 * 篩選模組 / 表單 / 待處理 · 已處理。點「審核」進申請中心詳情頁(不經業務模組頁面權限)。
 * 「待處理」可勾選多筆批次核准(B18):勾選跨頁保留、最多 50 筆,屬大量資料不放網址;
 * 換篩選條件時清掉。結果中被擋下 / 失敗的保持勾選(已不在你手上的除外)。
 */
export const MyTasksTab = ({ modules }: MyTasksTabProps) => {
  const t = useTranslations("admin.applyCenter.tasks");
  const tBatch = useTranslations("admin.applyCenter.batchApprove");
  const invalidateWorkflow = useWorkflowCache();
  const [selectedTasks, setSelectedTasks] = useState<
    WorkflowTaskFieldsFragment[]
  >([]);
  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const navigate = useNavigate();
  const routeOf = useModuleRoutes();
  const temporalText = useTemporalText();
  const [filters, setFilters] = useUrlState(
    APPLY_CENTER_LIST_KEY,
    myTasksListSchema,
  );
  const { module: moduleKey, form: formKey, done, page } = filters;
  const list = useMyTasks({
    moduleKey,
    formKey,
    done: done === "done",
    page,
    pageSize: PAGE_SIZE,
  });
  const viewRoute = routeOf(APPLY_CENTER_VIEW_PAGE_KEY);
  const titleOf = (row: WorkflowTaskFieldsFragment) =>
    row.summary?.title ?? row.formName ?? row.formKey;

  /** 換篩選條件:回第一頁,勾選清掉(別的條件下勾的看不到,不留著一起送)。 */
  const changeFilters = (patch: Partial<typeof filters>) => {
    setSelectedTasks([]);
    setFilters((current) => ({ ...current, ...patch, page: 1 }));
  };

  const rowSelection: DataTableRowSelection<WorkflowTaskFieldsFragment> = {
    selectedKeys: selectedTasks.map((task) => task.id),
    onSelectedKeysChange: (keys) => {
      // 已勾的任務留著當時的那一列(別頁勾的不在目前的清單裡)
      setSelectedTasks(
        keys.flatMap((key) => {
          const task =
            selectedTasks.find((item) => item.id === key) ??
            list.items.find((item) => item.id === key);
          return task === undefined ? [] : [task];
        }),
      );
    },
    maxCount: BATCH_APPROVE_LIMIT,
    isRowSelectable: (row) => row.status === WorkflowTaskStatus.Pending,
    hint: tBatch("hint"),
    actions: (
      <Button
        size="small"
        onClick={() => {
          setIsBatchOpen(true);
        }}
      >
        {tBatch("approve", { count: selectedTasks.length })}
      </Button>
    ),
    labels: {
      selectedCount: (count) => tBatch("selectedCount", { count }),
      clear: tBatch("clear"),
      selectPage: tBatch("selectPage"),
      selectRow: (row) => tBatch("selectRow", { label: titleOf(row) }),
    },
  };

  const columns: DataTableColumn<WorkflowTaskFieldsFragment>[] = [
    {
      key: "module",
      header: t("module"),
      width: 140,
      accessor: (row) => row.moduleName ?? row.moduleKey,
    },
    {
      key: "form",
      header: t("form"),
      width: 160,
      accessor: (row) => row.formName ?? row.formKey,
    },
    {
      key: "title",
      header: t("title"),
      width: 200,
      isEmphasized: true,
      accessor: (row) => row.summary?.title ?? "—",
    },
    {
      key: "applicant",
      header: t("applicant"),
      width: 120,
      accessor: (row) => row.applicant?.name ?? "—",
    },
    {
      key: "step",
      header: t("step"),
      width: 140,
      accessor: (row) => row.stepName,
    },
    {
      key: "status",
      header: t("status"),
      width: 110,
      render: ({ row }) => (
        <Tag tone={TASK_TONE[row.status]} label={t(`statuses.${row.status}`)} />
      ),
    },
    {
      key: "createdAt",
      header: t("createdAt"),
      width: 170,
      accessor: (row) => temporalText(row.createdAt, "datetime"),
    },
    {
      key: "actions",
      header: t("actions"),
      width: 110,
      pinned: "right",
      render: ({ row }) =>
        viewRoute === null ? null : (
          <Button
            size="small"
            variant="text"
            aria-label={t("openOf", { label: titleOf(row) })}
            onClick={() => {
              void navigate(`${viewRoute}/${row.instanceId}`);
            }}
          >
            {row.status === WorkflowTaskStatus.Pending
              ? t("review")
              : t("view")}
          </Button>
        ),
    },
  ];

  return (
    <Stack spacing={2} sx={{ flex: 1, minHeight: 0 }}>
      <ApplyCenterFilters
        modules={modules}
        moduleKey={moduleKey}
        onModuleKeyChange={(next) => {
          changeFilters({ module: next });
        }}
        formKey={formKey}
        onFormKeyChange={(next) => {
          changeFilters({ form: next });
        }}
      >
        <SelectField<DoneFilter>
          label={t("doneFilter")}
          value={done}
          size="small"
          sx={{ width: 140 }}
          options={[
            { value: "pending", label: t("pending") },
            { value: "done", label: t("done") },
          ]}
          onChange={(next) => {
            changeFilters({ done: next });
          }}
        />
      </ApplyCenterFilters>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataTable
          columns={columns}
          rows={list.items}
          getRowKey={(row) => row.id}
          isLoading={list.isLoading}
          emptyMessage={done === "pending" ? t("emptyPending") : t("emptyDone")}
          size="small"
          aria-label={t("tableAria")}
          rowSelection={done === "pending" ? rowSelection : undefined}
        />
      </Box>
      <TablePager
        totalCount={list.totalCount}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={(next) => {
          setFilters((current) => ({ ...current, page: next }));
        }}
      />
      {isBatchOpen && (
        <BatchApproveDialog
          tasks={selectedTasks}
          onClose={() => {
            setIsBatchOpen(false);
          }}
          onSettled={(results) => {
            // 被擋下 / 失敗的保持勾選;已不在你手上的會從清單消失,一併取消
            const kept = new Set(
              results
                .filter(
                  (item) =>
                    !item.ok &&
                    item.reason !== WorkflowBatchApproveFailure.NotYours,
                )
                .map((item) => item.taskId),
            );
            for (const instanceId of new Set(
              selectedTasks.map((task) => task.instanceId),
            )) {
              invalidateWorkflow(instanceId);
            }
            setSelectedTasks((current) =>
              current.filter((task) => kept.has(task.id)),
            );
          }}
        />
      )}
    </Stack>
  );
};
