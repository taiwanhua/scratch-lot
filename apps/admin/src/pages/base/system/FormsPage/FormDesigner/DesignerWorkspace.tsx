import { useState } from "react";
import { useTranslations } from "use-intl";

import type { FieldType } from "@repo/domain/form";
import {
  type FormFieldsFragment,
  type FormVersionFieldsFragment,
  useModuleListColumnsQuery,
} from "@repo/graphql";
import { Box } from "@repo/ui/box";
import { Stack } from "@repo/ui/stack";

import { JsonPreview } from "@/components/base/JsonPreview";
import { useSession } from "@/hooks/base/useSession";
import { definitionOf, rawOf } from "@/lib/base/form-engine/definition";
import type { DesignSection } from "@/lib/base/form-engine/design-definition";
import type { DesignerIssue } from "@/lib/base/form-engine/designer-issues";
import {
  fieldById,
  fieldKeyProblemOf,
  sectionCols,
  spanOf,
} from "@/lib/base/form-engine/designer-ops";
import {
  fieldReferences,
  sectionReferences,
} from "@/lib/base/form-engine/field-references";

import { ComponentPalette } from "./ComponentPalette";
import { DeleteFieldDialog } from "./DeleteFieldDialog";
import { DeleteSectionDialog } from "./DeleteSectionDialog";
import { DesignerCanvas } from "./DesignerCanvas";
import { DesignerPreview } from "./DesignerPreview";
import { type DesignerMode, DesignerToolbar } from "./DesignerToolbar";
import { FormSettingsPanel } from "./FormSettingsPanel/FormSettingsPanel";
import { IssueList } from "./IssueList";
import { FieldPropertyPanel } from "./PropertyPanel/FieldPropertyPanel";
import { SectionPropertyPanel } from "./PropertyPanel/SectionPropertyPanel";
import { useDesignerSave } from "./useDesignerSave";
import { useDesignerState } from "./useDesignerState";

/** 指到整個分區的版面位置(`sections.<n>`,不含列 / 格)。 */
const SECTION_PATH = /^sections\.(\d+)$/;

export interface DesignerWorkspaceProps {
  form: FormFieldsFragment;
  draft: FormVersionFieldsFragment;
  onSaved: () => void;
  onReload: () => void;
}

/**
 * 設計器本體(Spec 6a §8 畫面 2):元件面板 / 畫布 / 屬性面板 / JSON 預覽 / 檢查結果;「預覽」切到 `preview` 模式。
 * 存草稿帶 `expectedDraftRevision`(= 讀到或上次存完的 `draftRevision`);不符 → 提示「已被別人更新,請重新載入」。
 * 有沒有未存的變更回報給 `useDesignerDraftStore`(換表單攔截、發布跳窗提示都看它)。
 */
export const DesignerWorkspace = ({
  form,
  draft,
  onSaved,
  onReload,
}: DesignerWorkspaceProps) => {
  const t = useTranslations("admin.forms.designer");
  const { session } = useSession();
  const state = useDesignerState(definitionOf(draft));
  const { definition, output, report } = state;
  const saving = useDesignerSave({
    formKey: form.key,
    initialRevision: draft.draftRevision,
    definition: output,
    isDirty: state.isDirty,
    markSaved: state.markSaved,
    onSaved,
  });
  const [mode, setMode] = useState<DesignerMode>("design");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [removingSection, setRemovingSection] = useState<DesignSection | null>(
    null,
  );
  const listColumns = useModuleListColumnsQuery(session.client, {
    moduleKey: form.moduleKey,
  });
  const listColumnFieldKeys = (
    listColumns.data?.moduleListColumns.columns ?? []
  )
    .filter((column) => [null, undefined, form.key].includes(column.formKey))
    .map((column) => column.key);
  const selected = fieldById(definition, state.selectedFieldId) ?? null;
  const selectedSectionIndex = definition.layout.sections.findIndex(
    (section) => section.key === state.selectedSectionKey,
  );
  const selectedSection =
    selectedSectionIndex === -1
      ? undefined
      : definition.layout.sections.at(selectedSectionIndex);
  const allIssues = [...report.errors, ...report.warnings];

  /** 點檢查結果定位:分區收合設定的錯誤 → 分區設定;有欄位就選它;其餘(摘要槽、帶入規則、版面格)回到表單設定。 */
  const locate = (issue: DesignerIssue) => {
    setMode("design");
    const sectionIndex = SECTION_PATH.exec(
      issue.location.layoutPath ?? "",
    )?.[1];
    const section =
      sectionIndex === undefined
        ? undefined
        : definition.layout.sections.at(Number(sectionIndex));
    if (issue.code.startsWith("SECTION_") && section !== undefined) {
      state.selectSection(section.key);
      return;
    }
    state.selectByKey(issue.location.fieldKey ?? null);
  };
  const deletingField = fieldById(definition, deleting);

  // 選了分區(且沒有選欄位)→ 屬性面板顯示分區設定
  const sectionPanel =
    selected === null && selectedSection !== undefined ? (
      <SectionPropertyPanel
        key={selectedSection.key}
        section={selectedSection}
        fields={definition.fields}
        issues={allIssues.filter(
          (issue) =>
            issue.location.layoutPath ===
            `sections.${String(selectedSectionIndex)}`,
        )}
        onChange={(patch) => {
          state.updateSection(selectedSection.key, patch);
        }}
        onBack={() => {
          state.selectSection(null);
        }}
      />
    ) : null;

  return (
    <Stack spacing={2}>
      <DesignerToolbar
        mode={mode}
        onModeChange={setMode}
        revision={saving.revision}
        isDirty={state.isDirty}
        isSaving={saving.isPending}
        error={saving.error}
        onSave={() => {
          void saving.save();
        }}
        onReload={onReload}
      />
      {mode === "preview" ? (
        <DesignerPreview
          formKey={form.key}
          definition={output}
          isDirty={state.isDirty}
        />
      ) : (
        <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
          <ComponentPalette
            onAddField={(type: FieldType) => {
              state.add(
                type,
                t(`types.${type}`),
                null,
                t("newSection"),
                t("newColumn"),
              );
            }}
            onAddSection={() => {
              state.addSection(t("newSection"));
            }}
          />
          <DesignerCanvas
            formKey={form.key}
            definition={definition}
            selectedFieldId={state.selectedFieldId}
            selectedSectionKey={state.selectedSectionKey}
            onSelectField={state.select}
            onAddField={(type, target) => {
              state.add(
                type,
                t(`types.${type}`),
                target,
                t("newSection"),
                t("newColumn"),
              );
            }}
            onMoveField={state.move}
            onRenameSection={state.renameSection}
            onSelectSection={state.selectSection}
            onRemoveSection={setRemovingSection}
          />
          <Box
            component="section"
            aria-label={t("properties")}
            sx={{ width: 360, flexShrink: 0 }}
          >
            {sectionPanel ??
              (selected === null ? (
                <FormSettingsPanel
                  definition={definition}
                  form={{ key: form.key, name: form.name }}
                  issues={allIssues.filter(
                    (issue) => issue.location.fieldKey === undefined,
                  )}
                  onChange={state.patchSettings}
                />
              ) : (
                <FieldPropertyPanel
                  key={selected._id}
                  field={selected}
                  fields={definition.fields}
                  formKey={form.key}
                  span={spanOf(definition, selected._id)}
                  issues={allIssues.filter(
                    (issue) => issue.location.fieldKey === selected.key,
                  )}
                  keyProblemOf={(key) =>
                    fieldKeyProblemOf(definition, selected._id, key)
                  }
                  onChange={(next) => {
                    state.update(selected._id, next);
                  }}
                  onSpanChange={(span) => {
                    state.setSpan(selected._id, span);
                  }}
                  onDelete={() => {
                    setDeleting(selected._id);
                  }}
                  onBack={() => {
                    state.select(null);
                  }}
                />
              ))}
          </Box>
        </Stack>
      )}
      <IssueList
        report={report}
        regexStatus={state.regexStatus}
        onLocate={locate}
      />
      <JsonPreview
        value={rawOf(output)}
        label={t("jsonPreview")}
        maxHeight={320}
      />
      {deletingField !== undefined && (
        <DeleteFieldDialog
          field={deletingField}
          references={fieldReferences(
            output,
            deletingField.key,
            listColumnFieldKeys,
          )}
          onCancel={() => {
            setDeleting(null);
          }}
          onConfirm={() => {
            state.remove(deletingField._id);
            setDeleting(null);
          }}
        />
      )}
      {removingSection !== null && (
        <DeleteSectionDialog
          section={removingSection}
          references={sectionReferences(
            output,
            sectionCols(removingSection).map((col) => col.fieldKey),
            listColumnFieldKeys,
          )}
          onCancel={() => {
            setRemovingSection(null);
          }}
          onConfirm={(sectionMode) => {
            state.removeSection(removingSection.key, sectionMode);
            setRemovingSection(null);
          }}
        />
      )}
    </Stack>
  );
};
