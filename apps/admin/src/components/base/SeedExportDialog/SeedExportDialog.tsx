import { useState } from "react";
import { useTranslations } from "use-intl";

import { isValidDefinitionRevision } from "@repo/domain/seed";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { Dialog } from "@repo/ui/dialog";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Typography } from "@repo/ui/typography";

import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import {
  type SeedExportError,
  type SeedExportFile,
  type SeedExportInput,
  downloadTextFile,
  seedExportErrorOf,
} from "@/lib/base/seed-export";

export interface SeedExportDialogProps {
  /** 匯出的是表單還是流程(只影響說明文字) */
  kind: "form" | "workflow";
  /** 表單 / 流程的顯示名 */
  name: string;
  /** 版本面板上選定的那一版(已發布) */
  version: number;
  /** 向 api 取這一版的設定檔(`exportFormSeed` / `exportWorkflowSeed`);失敗就丟出 graphql 的錯誤 */
  fetchSeed: (input: SeedExportInput) => Promise<SeedExportFile>;
  onClose: () => void;
}

/**
 * 匯出專案設定(表單與流程版本面板共用):填版本識別與發布說明 → 下載 `.seed.ts`。
 * 檔名與內容都由 api 決定,這裡原樣存檔,不另外組一份。只讀不寫,所以成功後不必重查任何資料。
 * 這一版夾帶只在本環境有意義的設定時整份不匯出,api 逐項指出位置與修正原因,就地列出。
 */
export const SeedExportDialog = ({
  kind,
  name,
  version,
  fetchSeed,
  onClose,
}: SeedExportDialogProps) => {
  const t = useTranslations("admin.seedExport");
  const tErrors = useTranslations("admin.seedExport.errors");
  const [revision, setRevision] = useState("");
  const [changelog, setChangelog] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<SeedExportError | null>(null);
  const isRevisionInvalid =
    revision !== "" && !isValidDefinitionRevision(revision);
  const isIncomplete =
    !isValidDefinitionRevision(revision) || changelog.trim() === "";

  const feedback = useMutationFeedback<SeedExportFile>({
    success: (file) => t("feedback.exportSuccess", { fileName: file.fileName }),
    error: (failure) => tErrors(seedExportErrorOf(failure).code),
    onSuccess: onClose,
    onError: (failure) => {
      setError(seedExportErrorOf(failure));
      setIsPending(false);
    },
  });

  const exportSeed = (): void => {
    setError(null);
    setIsPending(true);
    void fetchSeed({ revision, changelog: changelog.trim() })
      .then((file) => {
        downloadTextFile(file);
        feedback.onSuccess(file);
      })
      .catch(feedback.onError);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      title={t("title")}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={isIncomplete || isPending} onClick={exportSeed}>
            {t("confirm")}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2">
          {t("body", { kind, name, version })}
        </Typography>
        <Alert severity="info">{t("scope")}</Alert>
        <TextField
          label={t("revision")}
          value={revision}
          onChange={(event) => {
            setRevision(event.target.value);
          }}
          error={isRevisionInvalid}
          helperText={
            isRevisionInvalid ? t("revisionInvalid") : t("revisionHint")
          }
          required
          size="small"
        />
        <TextField
          label={t("changelog")}
          value={changelog}
          onChange={(event) => {
            setChangelog(event.target.value);
          }}
          multiline
          minRows={3}
          required
          size="small"
        />
        {error !== null && (
          <Alert severity="error">
            <Stack spacing={0.5}>
              <span>{tErrors(error.code)}</span>
              {error.issues !== undefined && <span>{t("issuesTitle")}</span>}
              {(error.issues ?? []).map((issue) => (
                <span key={`${issue.path}-${issue.code}`}>
                  {t("issueLine", { path: issue.path, message: issue.message })}
                </span>
              ))}
            </Stack>
          </Alert>
        )}
      </Stack>
    </Dialog>
  );
};
