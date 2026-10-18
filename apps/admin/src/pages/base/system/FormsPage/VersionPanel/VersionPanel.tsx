import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type FormFieldsFragment,
  type FormVersionFieldsFragment,
  FormVersionStatus,
  useCreateFormVersionDraftMutation,
  useExportFormSeedQuery,
  useFormVersionsQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Stack } from "@repo/ui/stack";
import { Table } from "@repo/ui/table";
import { Tag, type TagTone } from "@repo/ui/tag";

import { SeedExportDialog } from "@/components/base/SeedExportDialog/SeedExportDialog";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { usePermissions } from "@/hooks/base/usePermissions";
import { useSession } from "@/hooks/base/useSession";
import { useTemporalText } from "@/hooks/base/useTemporalText";
import { definitionOf } from "@/lib/base/form-engine/definition";
import { formErrorOf } from "@/lib/base/form-engine/form-errors";
import { versionDiff } from "@/lib/base/form-engine/version-diff";

import { DeleteDraftDialog } from "./DeleteDraftDialog";
import { PublishDialog } from "./PublishDialog";
import { RetireDialog } from "./RetireDialog";
import { UpgradeDialog } from "./UpgradeDialog";
import { VersionDiffView } from "./VersionDiffView";

export interface VersionPanelProps {
  form: FormFieldsFragment;
  /** 寫入成功後(清單、單張、版本、草稿都要重查) */
  onChanged: () => void;
  /** 「檢視」已發布 / 已退役的版本:設計頁籤以唯讀設計器打開那一版 */
  onView: (version: number) => void;
}

const STATUS_TONE: Record<FormVersionStatus, TagTone> = {
  [FormVersionStatus.Draft]: "grey",
  [FormVersionStatus.Publishing]: "warning",
  [FormVersionStatus.Published]: "success",
  [FormVersionStatus.Retired]: "grey",
};

/**
 * 版本面板:草稿 / 發布(含中斷重試)/ 退役目前版本、changelog、
 * 與上一版差異、以任一版本(已發布或已退役)為基底開新草稿、「檢視」任一已發布 / 已退役版本(唯讀設計器)、
 * 刪除草稿(確認跳窗;發布中不可)、「將舊版資料升級到此版」(已發布的版本;表單所屬模組的 `edit`,
 * 本組織綁了流程就不顯示、改一行提示)、「匯出專案設定」(共用表單的目前發布版;下載 `.seed.ts`)。
 * 設計相關的按鈕依 `form.abilities.canEdit`;
 * 發布中斷時只剩「重試發布」(api 在中斷期間擋開草稿 / 退役 / 再發布)。
 */
export const VersionPanel = ({
  form,
  onChanged,
  onView,
}: VersionPanelProps) => {
  const t = useTranslations("admin.forms.versions");
  const temporalText = useTemporalText();
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const [isPublishing, setIsPublishing] = useState(false);
  const [isRetiring, setIsRetiring] = useState(false);
  const [isDeletingDraft, setIsDeletingDraft] = useState(false);
  const [diffOf, setDiffOf] = useState<number | null>(null);
  const [upgradeTo, setUpgradeTo] = useState<number | null>(null);
  const [exportOf, setExportOf] = useState<number | null>(null);
  const tSeedExport = useTranslations("admin.seedExport");
  const { hasPermission } = usePermissions();
  const versions = useFormVersionsQuery(session.client, { formKey: form.key });
  const items = versions.data?.formVersions.items ?? [];
  const draft = items.find((item) => item.status === FormVersionStatus.Draft);
  const canEdit = form.abilities.canEdit;
  // 升級動的是本組織的提交資料:看的是表單所屬模組的 edit,不是表單設計的權限
  const canUpgradeData = hasPermission(`${form.moduleKey}.edit`);
  const hasWorkflow =
    form.workflowBinding !== null && form.workflowBinding !== undefined;
  const hasPublished = items.some(
    (item) => item.status === FormVersionStatus.Published,
  );
  // 共用表單只有站在根組織的人改得動(`canEdit`),所以這兩個條件合起來就是 api 的匯出判準
  const canExportSeed = form.isShared && canEdit;

  const createDraft = useCreateFormVersionDraftMutation(
    session.client,
    useMutationFeedback({
      success: t("draftCreated"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: onChanged,
    }),
  );
  const previousOf = (item: FormVersionFieldsFragment) =>
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

  const renderActions = (item: FormVersionFieldsFragment) => {
    const isDraft = item.status === FormVersionStatus.Draft;
    const isCurrent =
      item.status === FormVersionStatus.Published &&
      item.version === form.currentVersion;
    const isBase =
      item.status === FormVersionStatus.Published ||
      item.status === FormVersionStatus.Retired;
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
        {canEdit && isDraft && (
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
              setIsDeletingDraft(true);
            }}
          >
            {t("deleteDraft")}
          </Button>
        )}
        {canEdit && isCurrent && (
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
                input: { formKey: form.key, baseVersion: item.version },
              });
            }}
          >
            {t("baseOn", { version: item.version ?? 0 })}
          </Button>
        )}
        {canUpgradeData &&
          !hasWorkflow &&
          item.status === FormVersionStatus.Published &&
          typeof item.version === "number" && (
            <Button
              size="small"
              variant="text"
              onClick={() => {
                setUpgradeTo(item.version ?? null);
              }}
            >
              {t("upgrade")}
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

  return (
    <Stack spacing={2}>
      {canUpgradeData && hasWorkflow && hasPublished && (
        <Alert severity="info">{t("upgradeBlockedByWorkflow")}</Alert>
      )}
      {canEdit && draft === undefined && items.length === 0 && (
        <Stack direction="row">
          <Button
            variant="outlined"
            disabled={createDraft.isPending}
            onClick={() => {
              createDraft.mutate({ input: { formKey: form.key } });
            }}
          >
            {t("newDraft")}
          </Button>
        </Stack>
      )}
      <Table<FormVersionFieldsFragment>
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
      {diffTarget !== undefined && diffBase !== undefined && (
        <VersionDiffView
          diff={versionDiff(
            definitionOf(diffBase).fields,
            definitionOf(diffTarget).fields,
          )}
        />
      )}
      {isPublishing && draft !== undefined && (
        <PublishDialog
          formKey={form.key}
          formName={form.name}
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
      {isDeletingDraft && draft !== undefined && (
        <DeleteDraftDialog
          formKey={form.key}
          draftRevision={draft.draftRevision}
          onClose={() => {
            setIsDeletingDraft(false);
          }}
          onDeleted={() => {
            setIsDeletingDraft(false);
            onChanged();
          }}
        />
      )}
      {upgradeTo !== null && (
        <UpgradeDialog
          formKey={form.key}
          targetVersion={upgradeTo}
          onClose={() => {
            setUpgradeTo(null);
          }}
          onUpgraded={() => {
            setUpgradeTo(null);
            onChanged();
          }}
        />
      )}
      {exportOf !== null && (
        <SeedExportDialog
          kind="form"
          name={form.name}
          version={exportOf}
          fetchSeed={async (input) => {
            const payload = await useExportFormSeedQuery.fetcher(
              session.client,
              { input: { formKey: form.key, version: exportOf, ...input } },
            )();
            return payload.exportFormSeed;
          }}
          onClose={() => {
            setExportOf(null);
          }}
        />
      )}
      {isRetiring && typeof form.currentVersion === "number" && (
        <RetireDialog
          formKey={form.key}
          expectedVersion={form.currentVersion}
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
