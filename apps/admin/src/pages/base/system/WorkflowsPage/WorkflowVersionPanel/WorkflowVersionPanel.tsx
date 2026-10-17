import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type WorkflowFieldsFragment,
  type WorkflowVersionFieldsFragment,
  WorkflowVersionStatus,
  useCreateWorkflowVersionDraftMutation,
  useExportWorkflowSeedQuery,
  useWorkflowVersionsQuery,
} from "@repo/graphql";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Table } from "@repo/ui/table";
import { Tag, type TagTone } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { SeedExportDialog } from "@/components/base/SeedExportDialog/SeedExportDialog";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { definitionOf } from "@/lib/base/workflow/definition";
import { workflowVersionDiff } from "@/lib/base/workflow/version-diff";
import { workflowErrorOf } from "@/lib/base/workflow/workflow-errors";

import { DeleteWorkflowDraftDialog } from "./DeleteWorkflowDraftDialog";
import { PublishWorkflowDialog } from "./PublishWorkflowDialog";
import { RetireWorkflowDialog } from "./RetireWorkflowDialog";

export interface WorkflowVersionPanelProps {
  workflow: WorkflowFieldsFragment;
  onChanged: () => void;
  /** 「檢視 vN」:設計頁籤以唯讀打開那一版 */
  onView: (version: number) => void;
}

const STATUS_TONE: Record<WorkflowVersionStatus, TagTone> = {
  [WorkflowVersionStatus.Draft]: "grey",
  [WorkflowVersionStatus.Publishing]: "warning",
  [WorkflowVersionStatus.Published]: "success",
  [WorkflowVersionStatus.Retired]: "grey",
};

type VersionRow = WorkflowVersionFieldsFragment;

/**
 * 版本面板(Spec 6b §8 畫面 4,同表單版本面板):草稿 / 發布(含中斷重試)/ 退役目前版本、changelog、
 * 與上一版差異、以任一版本(已發布或已退役)為基底開新草稿、檢視某一版(唯讀)、刪除草稿、
 * 「匯出專案設定」(共用流程的目前發布版;下載 `.seed.ts`)。
 * 發布看 `abilities.canPublish`、開草稿與刪草稿看 `abilities.canEdit`;發布中斷時只剩「重試發布」。
 */
export const WorkflowVersionPanel = ({
  workflow,
  onChanged,
  onView,
}: WorkflowVersionPanelProps) => {
  const t = useTranslations("admin.workflows.versions");
  const tErrors = useTranslations("admin.workflows.errors");
  const temporalText = useTemporalText();
  const { session } = useSession();
  const [isPublishing, setIsPublishing] = useState(false);
  const [isRetiring, setIsRetiring] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [diffOf, setDiffOf] = useState<number | null>(null);
  const [exportOf, setExportOf] = useState<number | null>(null);
  const tSeedExport = useTranslations("admin.seedExport");
  const versions = useWorkflowVersionsQuery(session.client, {
    workflowKey: workflow.key,
  });
  const items = versions.data?.workflowVersions.items ?? [];
  const draft = items.find(
    (item) => item.status === WorkflowVersionStatus.Draft,
  );
  const { canEdit, canPublish } = workflow.abilities;
  // 共用流程只有站在根組織的人發布得了(`canPublish`),所以這兩個條件合起來就是 api 的匯出判準
  const canExportSeed = workflow.isShared && canPublish;

  const createDraft = useCreateWorkflowVersionDraftMutation(
    session.client,
    useMutationFeedback({
      success: t("draftCreated"),
      error: (failure) => tErrors(workflowErrorOf(failure).code),
      onSuccess: onChanged,
    }),
  );
  const previousOf = (item: VersionRow): VersionRow | undefined =>
    items
      .filter(
        (candidate) =>
          candidate.version !== null &&
          candidate.version !== undefined &&
          item.version !== null &&
          item.version !== undefined &&
          candidate.version < item.version,
      )
      .toSorted((a, b) => (b.version ?? 0) - (a.version ?? 0))
      .at(0);

  const renderActions = (item: VersionRow) => {
    const isDraft = item.status === WorkflowVersionStatus.Draft;
    const isCurrent =
      item.status === WorkflowVersionStatus.Published &&
      item.version === workflow.currentVersion;
    const isBase =
      item.status === WorkflowVersionStatus.Published ||
      item.status === WorkflowVersionStatus.Retired;
    return (
      <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap" }}>
        {isBase && item.version !== null && item.version !== undefined && (
          <Button
            size="small"
            variant="text"
            onClick={() => {
              onView(item.version ?? 0);
            }}
          >
            {t("view", { version: item.version })}
          </Button>
        )}
        {canPublish && isDraft && (
          <Button
            size="small"
            onClick={() => {
              setIsPublishing(true);
            }}
          >
            {t("publish")}
          </Button>
        )}
        {canEdit && isDraft && (
          <Button
            size="small"
            variant="text"
            color="error"
            onClick={() => {
              setIsDeleting(true);
            }}
          >
            {t("deleteDraft")}
          </Button>
        )}
        {canPublish && isCurrent && (
          <Button
            size="small"
            variant="text"
            color="error"
            onClick={() => {
              setIsRetiring(true);
            }}
          >
            {t("retire")}
          </Button>
        )}
        {canEdit && isBase && draft === undefined && (
          <Button
            size="small"
            variant="text"
            disabled={createDraft.isPending}
            onClick={() => {
              createDraft.mutate({
                input: { workflowKey: workflow.key, baseVersion: item.version },
              });
            }}
          >
            {t("baseOn", { version: item.version ?? 0 })}
          </Button>
        )}
        {!isDraft && previousOf(item) !== undefined && (
          <Button
            size="small"
            variant="text"
            onClick={() => {
              setDiffOf(
                diffOf === item.version ? null : (item.version ?? null),
              );
            }}
          >
            {t("diff")}
          </Button>
        )}
        {canExportSeed && isCurrent && typeof item.version === "number" && (
          <Button
            size="small"
            variant="text"
            onClick={() => {
              setExportOf(item.version ?? null);
            }}
          >
            {tSeedExport("action")}
          </Button>
        )}
      </Stack>
    );
  };

  const diffTarget = items.find((item) => item.version === diffOf);
  const diffBase =
    diffTarget === undefined ? undefined : previousOf(diffTarget);
  const diff =
    diffTarget === undefined || diffBase === undefined
      ? null
      : workflowVersionDiff(definitionOf(diffBase), definitionOf(diffTarget));

  return (
    <Stack spacing={2}>
      <Table<VersionRow>
        aria-label={t("tableAria")}
        size="small"
        rows={items}
        getRowKey={(item) => item.id}
        isLoading={versions.isLoading}
        emptyMessage={t("empty")}
        columns={[
          {
            key: "version",
            header: t("version"),
            render: (item) =>
              item.version === null || item.version === undefined
                ? t("draftLabel", { revision: item.draftRevision })
                : t("versionLabel", { version: item.version }),
          },
          {
            key: "status",
            header: t("status"),
            render: (item) => (
              <Tag
                tone={STATUS_TONE[item.status]}
                label={t(`statuses.${item.status}`)}
              />
            ),
          },
          {
            key: "changelog",
            header: t("changelog"),
            render: (item) => item.changelog ?? "—",
          },
          {
            key: "publishedAt",
            header: t("publishedAt"),
            render: (item) =>
              item.publishedAt === null || item.publishedAt === undefined
                ? "—"
                : t("publishedLine", {
                    at: temporalText(item.publishedAt, "datetime"),
                    user: item.publishedBy?.name ?? "—",
                  }),
          },
          { key: "actions", header: t("actions"), render: renderActions },
        ]}
      />
      {diff !== null && (
        <Stack spacing={0.5} component="section" aria-label={t("diffRegion")}>
          <Typography variant="subtitle2">{t("diffTitle")}</Typography>
          <Typography variant="body2">
            {t("diffAdded", { steps: diff.added.join("、") || "—" })}
          </Typography>
          <Typography variant="body2">
            {t("diffRemoved", { steps: diff.removed.join("、") || "—" })}
          </Typography>
          <Typography variant="body2">
            {t("diffChanged", { steps: diff.changed.join("、") || "—" })}
          </Typography>
          {diff.isStructureChanged && (
            <Typography variant="body2">{t("diffStructure")}</Typography>
          )}
          {diff.flowCcChange === "added" && (
            <Typography variant="body2">{t("diffFlowCcAdded")}</Typography>
          )}
          {diff.flowCcChange === "removed" && (
            <Typography variant="body2">{t("diffFlowCcRemoved")}</Typography>
          )}
          {diff.flowCcChange === "changed" && (
            <Typography variant="body2">{t("diffFlowCcChanged")}</Typography>
          )}
        </Stack>
      )}
      {isPublishing && draft !== undefined && (
        <PublishWorkflowDialog
          workflowKey={workflow.key}
          draftRevision={draft.draftRevision}
          onClose={() => {
            setIsPublishing(false);
          }}
          onPublished={() => {
            setIsPublishing(false);
            onChanged();
          }}
        />
      )}
      {isDeleting && draft !== undefined && (
        <DeleteWorkflowDraftDialog
          workflowKey={workflow.key}
          draftRevision={draft.draftRevision}
          onClose={() => {
            setIsDeleting(false);
          }}
          onDeleted={() => {
            setIsDeleting(false);
            onChanged();
          }}
        />
      )}
      {exportOf !== null && (
        <SeedExportDialog
          kind="workflow"
          name={workflow.name}
          version={exportOf}
          fetchSeed={async (input) => {
            const payload = await useExportWorkflowSeedQuery.fetcher(
              session.client,
              {
                input: {
                  workflowKey: workflow.key,
                  version: exportOf,
                  ...input,
                },
              },
            )();
            return payload.exportWorkflowSeed;
          }}
          onClose={() => {
            setExportOf(null);
          }}
        />
      )}
      {isRetiring && (
        <RetireWorkflowDialog
          workflowKey={workflow.key}
          onClose={() => {
            setIsRetiring(false);
          }}
          onRetired={() => {
            setIsRetiring(false);
            onChanged();
          }}
        />
      )}
    </Stack>
  );
};
