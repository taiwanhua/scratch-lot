import { DndContext } from "@dnd-kit/core";
import { useState } from "react";
import { useTranslations } from "use-intl";

import {
  type FormFieldsFragment,
  useCreateFormVersionDraftMutation,
  useFormVersionQuery,
} from "@repo/graphql";
import { Alert } from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { CircularProgress } from "@repo/ui/circular-progress";
import { Stack } from "@repo/ui/stack";
import { Tabs } from "@repo/ui/tabs";
import { Typography } from "@repo/ui/typography";

import { FormRenderer } from "@/components/base/form-engine/FormRenderer/FormRenderer";
import { useMutationFeedback } from "@/hooks/base/useMutationFeedback";
import { useSession } from "@/hooks/base/useSession";
import { definitionOf } from "@/lib/base/form-engine/definition";
import { liveContextOf } from "@/lib/base/form-engine/expression-context";
import { formErrorOf } from "@/lib/base/form-engine/form-errors";

import { DesignerPreview } from "./DesignerPreview";
import type { DesignerMode } from "./DesignerToolbar";

export interface VersionViewerProps {
  form: FormFieldsFragment;
  /** 要看的已發布 / 已退役版號 */
  version: number;
  onClose: () => void;
  /** 開了新草稿(清單、版本、草稿都要重查) */
  onChanged: () => void;
}

const DESIGN_CONTEXT = liveContextOf(null, null, new Date(0));

/** 唯讀:畫布的格子不能拖(沒有感測器),點了也不選取。 */
const NO_SENSORS: never[] = [];

const ignoreSelect = (): void => undefined;

/**
 * 以設計器**唯讀**打開一個已發布 / 已退役的版本(版本面板「檢視」,`formVersion(formKey, version)`):
 * 設計模式照樣標示(有顯示條件、計算欄位、受保護…),不能改、不能存;「預覽」可以輸入測試值看條件與公式
 * (前端即時算;「以後端重算」帶這一版的版號打 `previewFormVersion`)。旁邊放「以此為基底開新草稿」(規則同版本面板:改得動、沒有草稿、
 * 沒有發布中斷)。
 */
export const VersionViewer = ({
  form,
  version,
  onClose,
  onChanged,
}: VersionViewerProps) => {
  const t = useTranslations("admin.forms.designer");
  const tVersions = useTranslations("admin.forms.versions");
  const tErrors = useTranslations("admin.forms.errors");
  const { session } = useSession();
  const [mode, setMode] = useState<DesignerMode>("design");
  const query = useFormVersionQuery(
    session.client,
    { formKey: form.key, version },
    { retry: false },
  );
  const createDraft = useCreateFormVersionDraftMutation(
    session.client,
    useMutationFeedback({
      success: tVersions("draftCreated"),
      error: (failure) => tErrors(formErrorOf(failure).code),
      onSuccess: () => {
        onChanged();
        onClose();
      },
    }),
  );
  const canBaseOn = form.abilities.canEdit && !form.hasDraft;

  if (query.isLoading) {
    return <CircularProgress aria-label={t("loading")} />;
  }
  const found = query.data?.formVersion.formVersion;
  if (found === undefined) {
    return (
      <Alert severity="error">
        {tErrors(
          query.error === null ? "NOT_FOUND" : formErrorOf(query.error).code,
        )}
      </Alert>
    );
  }
  const definition = definitionOf(found);

  return (
    <Stack
      spacing={2}
      component="section"
      aria-label={t("viewing", { version })}
    >
      <Alert severity="info">{t("viewingHint", { version })}</Alert>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <Tabs
          aria-label={t("mode")}
          value={mode}
          onChange={(next) => {
            setMode(next === "preview" ? "preview" : "design");
          }}
          items={[
            { value: "design", label: t("modeDesign") },
            { value: "preview", label: t("modePreview") },
          ]}
        />
        <Stack direction="row" spacing={1} sx={{ ml: "auto" }}>
          {canBaseOn && (
            <Button
              variant="outlined"
              size="small"
              disabled={createDraft.isPending}
              onClick={() => {
                createDraft.mutate({
                  input: { formKey: form.key, baseVersion: version },
                });
              }}
            >
              {tVersions("baseOn", { version })}
            </Button>
          )}
          <Button variant="text" size="small" onClick={onClose}>
            {t("closeViewing")}
          </Button>
        </Stack>
      </Stack>
      {form.abilities.canEdit && form.hasDraft && (
        <Typography variant="caption" color="text.secondary">
          {t("viewingHasDraft")}
        </Typography>
      )}
      {mode === "preview" ? (
        <DesignerPreview
          formKey={form.key}
          definition={definition}
          isDirty={false}
          version={version}
        />
      ) : (
        <DndContext sensors={NO_SENSORS}>
          <FormRenderer
            version={definition}
            values={{}}
            mode="design"
            context={{ formKey: form.key, version }}
            expressionContext={DESIGN_CONTEXT}
            design={{ selectedFieldId: null, onSelectField: ignoreSelect }}
          />
        </DndContext>
      )}
    </Stack>
  );
};
