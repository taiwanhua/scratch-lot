import { useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { z } from "zod";

import { DEFAULT_TENANT_TIMEZONE, type FieldDef } from "@repo/domain/form";
import {
  useFormSubmissionAttachmentUrlQuery,
  useFormSubmissionQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { Tag } from "@repo/ui/tag";
import { Typography } from "@repo/ui/typography";

import { useFormRuntimeVersion } from "@/hooks/base/useFormRuntimeVersion";
import { useIsCurrentFormVersion } from "@/hooks/base/useIsCurrentFormVersion";
import { useSession } from "@/hooks/base/useSession";
import { useTenantTimezone } from "@/hooks/base/useTenantTimezone";
import { useUrlState } from "@/hooks/base/useUrlState";
import {
  liveContextOf,
  revisionContextOf,
} from "@/lib/base/form-engine/expression-context";
import { permissionsOfSubmission } from "@/lib/base/form-engine/field-permissions";
import { formErrorOf } from "@/lib/base/form-engine/form-errors";

import { SubmissionStatusTag } from "../../workflow/SubmissionStatusTag";
import { FormRenderer } from "../FormRenderer/FormRenderer";
import { RevisionHistory } from "./RevisionHistory";

export interface FormSubmissionDetailProps {
  id: string;
  /** 「修訂紀錄」跳窗開著(按鈕在頁面標題列,由頁面控制;客製頁不給就沒有跳窗) */
  isHistoryOpen?: boolean;
  onHistoryClose?: () => void;
}

/** 檢視中的修訂號;0 = 目前內容(網址不寫)。 */
const revisionSchema = z.number().int().min(0).default(0);

/**
 * 詳情(Spec 6a §8 `<FormSubmissionDetail id>`、畫面 11):唯讀渲染 = 同一套填寫元件走 `readOnly`
 * (條件用**該修訂的 `ctx`**、定義用**該修訂的版本**(`viewedVersion`)、不重算存值;日期以讀者現在的租戶時區顯示)、現名 / 快照顯示(`displayValues`)、
 * 附件下載(簽名網址,看得到這一欄才簽)。表單 / 版本 / 狀態 / 建立者與修訂紀錄(含差異)收在「修訂紀錄」跳窗;
 * 從跳窗切到某個修訂時關掉跳窗、主體換成那個修訂並標「正在檢視修訂 N」。
 * 讀取權限(哪些欄位遮蔽)永遠看現在的讀者 —— 由 api 投影,前端照 `fieldStates` 不渲染看不到的欄。
 */
export const FormSubmissionDetail = ({
  id,
  isHistoryOpen = false,
  onHistoryClose,
}: FormSubmissionDetailProps) => {
  const t = useTranslations("admin.formEngine.detail");
  const tErrors = useTranslations("admin.formEngine.errors");
  const { session } = useSession();
  // 正在檢視的舊修訂(唯讀檢視)記在網址 `?revision=<n>`(REACT-14);沒有 = 目前內容
  const [revisionParam, setRevisionParam] = useUrlState(
    "revision",
    revisionSchema,
  );
  const viewedRevision = revisionParam === 0 ? null : revisionParam;
  const setViewedRevision = (revision: number | null) => {
    setRevisionParam(revision ?? 0);
  };
  const [downloadFailed, setDownloadFailed] = useState(false);

  const current = useFormSubmissionQuery(
    session.client,
    { id },
    { retry: false },
  );
  const viewed = useFormSubmissionQuery(
    session.client,
    { id, revision: viewedRevision ?? 0 },
    { enabled: viewedRevision !== null, retry: false },
  );
  const base = current.data?.formSubmission.submission ?? null;
  const shown =
    viewedRevision === null
      ? base
      : (viewed.data?.formSubmission.submission ?? null);
  const [now] = useState(() => new Date());
  // 看哪個修訂就用它自己的版本定義(舊版資料升級後,歷史修訂可能綁在較舊的版本)
  const version = useFormRuntimeVersion(
    base?.formKey ?? null,
    shown?.viewedVersion ?? null,
  );
  const tenantTimezone = useTenantTimezone();
  // 分區收合紀錄只在看目前版本時清掉已不存在的分區(看綁舊版本的單不能清掉新版本的紀錄)
  const isCurrentVersion = useIsCurrentFormVersion(
    base?.moduleKey ?? "",
    base?.formKey ?? "",
    shown?.viewedVersion ?? null,
  );
  // 已完成:條件用那次修訂的 ctx;草稿(還沒有 ctx):用真正的現在 + 填寫者本人與那一筆的組織、租戶時區
  const expressionContext = useMemo(() => {
    if (shown === null) {
      return null;
    }
    return shown.ctx === null || shown.ctx === undefined
      ? liveContextOf(
          shown.createdBy?.id ?? null,
          shown.orgId,
          now,
          tenantTimezone,
        )
      : revisionContextOf(shown.ctx);
  }, [shown, now, tenantTimezone]);
  const permissions = useMemo(
    () => (shown === null ? null : permissionsOfSubmission(shown)),
    [shown],
  );

  const download = async (field: FieldDef) => {
    setDownloadFailed(false);
    try {
      const payload = await useFormSubmissionAttachmentUrlQuery.fetcher(
        session.client,
        {
          id,
          fieldKey: field.key,
          ...(viewedRevision !== null && { revision: viewedRevision }),
        },
      )();
      window.open(
        payload.formSubmissionAttachmentUrl.url,
        "_blank",
        "noopener",
      );
    } catch {
      setDownloadFailed(true);
    }
  };

  if (current.isLoading || viewed.isLoading || version.isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  if (
    base === null ||
    shown === null ||
    version.definition === null ||
    expressionContext === null ||
    permissions === null
  ) {
    const code =
      current.error === null ? "NOT_FOUND" : formErrorOf(current.error).code;
    return <Alert severity="error">{tErrors(code)}</Alert>;
  }

  return (
    <Stack spacing={3}>
      {viewedRevision !== null && (
        <Stack direction="row">
          <Tag
            tone="primary"
            label={t("viewingRevision", { revision: viewedRevision })}
          />
        </Stack>
      )}
      {downloadFailed && <Alert severity="error">{t("downloadFailed")}</Alert>}
      <FormRenderer
        version={version.definition}
        values={shown.values}
        mode="readonly"
        context={{
          formKey: base.formKey,
          version: shown.viewedVersion,
          timezone: tenantTimezone ?? DEFAULT_TENANT_TIMEZONE,
        }}
        expressionContext={expressionContext}
        permissions={permissions}
        displayValues={shown.displayValues}
        onDownload={(field) => {
          void download(field);
        }}
        pruneMissingSections={isCurrentVersion}
      />
      {isHistoryOpen && (
        <Dialog
          open
          onClose={onHistoryClose}
          fullWidth
          maxWidth="md"
          title={t("revisions")}
          actions={
            <Button variant="text" onClick={onHistoryClose}>
              {t("close")}
            </Button>
          }
        >
          <Stack spacing={2}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <Typography variant="body2" color="text.secondary">
                {t("formLine", {
                  form: base.formName ?? base.formKey,
                  version: base.version,
                })}
              </Typography>
              <SubmissionStatusTag
                status={base.status}
                blocked={base.blocked}
              />
              <Typography variant="body2" color="text.secondary">
                {t("createdBy", { name: base.createdBy?.name ?? "—" })}
              </Typography>
            </Stack>
            <RevisionHistory
              submission={base}
              viewedRevision={viewedRevision}
              onViewRevision={(revision) => {
                setViewedRevision(revision);
                onHistoryClose?.();
              }}
            />
          </Stack>
        </Dialog>
      )}
    </Stack>
  );
};
