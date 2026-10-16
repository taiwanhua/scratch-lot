import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useTranslations } from "use-intl";

import type { FieldType } from "@repo/domain/form";
import { IconButton } from "@repo/ui/icon-button";
import { DeleteIcon, EditIcon } from "@repo/ui/icons";
import { Stack } from "@repo/ui/stack";
import { TextField } from "@repo/ui/text-field";
import { Tooltip } from "@repo/ui/tooltip";

import { FormRenderer } from "@/components/base/form-engine/FormRenderer/FormRenderer";
import type {
  DesignDefinition,
  DesignSection,
} from "@/lib/base/form-engine/design-definition";
import { parseDesignId } from "@/lib/base/form-engine/design-ids";
import {
  type PlaceTarget,
  sectionCols,
} from "@/lib/base/form-engine/designer-ops";
import { liveContextOf } from "@/lib/base/form-engine/expression-context";

import { UnplacedFields } from "./UnplacedFields";

/** 拖超過這個距離才算拖拉(否則是點擊選取)。 */
const DRAG_START_DISTANCE = 6;

export interface DesignerCanvasProps {
  formKey: string;
  /** 設計器內部的定義(欄位帶內部 id;選取、拖拉都以 id 認欄位) */
  definition: DesignDefinition;
  selectedFieldId: string | null;
  onSelectField: (fieldId: string) => void;
  onAddField: (type: FieldType, target: PlaceTarget) => void;
  onMoveField: (fieldId: string, target: PlaceTarget) => void;
  onRenameSection: (sectionKey: string, title: string) => void;
  /** 打開分區設定(屬性面板換成「分區設定」:收合相關) */
  onSelectSection: (sectionKey: string) => void;
  onRemoveSection: (section: DesignSection) => void;
}

const DESIGN_CONTEXT = liveContextOf(null, null, new Date(0));

/**
 * 設計器畫布(Spec 6a §8 畫面 2):`FormRenderer` 的 `design` 模式(不跑條件與計算、只標示),
 * dnd-kit 拖拉 —— 欄位換位置 / 換分區、從元件面板拖進新欄位、從「未放置」拖回版面。
 * 拖到某欄上 = 放在它前面;拖到分區尾端的放置區 = 放在分區最後。
 */
export const DesignerCanvas = ({
  formKey,
  definition,
  selectedFieldId,
  onSelectField,
  onAddField,
  onMoveField,
  onRenameSection,
  onSelectSection,
  onRemoveSection,
}: DesignerCanvasProps) => {
  const t = useTranslations("admin.forms.designer");
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_START_DISTANCE },
    }),
  );

  const targetOf = (overId: string): PlaceTarget | null => {
    const over = parseDesignId(overId);
    if (over?.kind === "section") {
      return { sectionKey: over.key, beforeId: null };
    }
    if (over?.kind !== "field") {
      return null;
    }
    const section = definition.layout.sections.find((candidate) =>
      sectionCols(candidate).some((col) => col._id === over.key),
    );
    return section === undefined
      ? null
      : { sectionKey: section.key, beforeId: over.key };
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null) {
      return;
    }
    const source = parseDesignId(String(active.id));
    const target = targetOf(String(over.id));
    if (source === null || target === null) {
      return;
    }
    if (source.kind === "palette") {
      onAddField(source.key as FieldType, target);
      return;
    }
    if (source.kind === "field") {
      onMoveField(source.key, target);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <Stack
        component="section"
        aria-label={t("canvas")}
        spacing={2}
        sx={{ flex: 1, minWidth: 0 }}
      >
        <FormRenderer
          version={definition}
          values={{}}
          mode="design"
          context={{ formKey, version: null }}
          expressionContext={DESIGN_CONTEXT}
          design={{
            selectedFieldId,
            onSelectField,
            renderSectionActions: (layoutSection) => {
              const section = definition.layout.sections.find(
                (candidate) => candidate.key === layoutSection.key,
              );
              return (
                section !== undefined && (
                  <Stack
                    direction="row"
                    spacing={0.5}
                    sx={{ alignItems: "center" }}
                  >
                    <TextField
                      label={t("sectionTitle")}
                      size="small"
                      value={section.title}
                      onChange={(event) => {
                        onRenameSection(section.key, event.target.value);
                      }}
                    />
                    <Tooltip title={t("sectionSettings")} describeChild={false}>
                      <IconButton
                        size="small"
                        aria-label={t("sectionSettingsOf", {
                          title: section.title,
                        })}
                        onClick={() => {
                          onSelectSection(section.key);
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("removeSection")} describeChild={false}>
                      <IconButton
                        size="small"
                        aria-label={t("removeSectionOf", {
                          title: section.title,
                        })}
                        onClick={() => {
                          onRemoveSection(section);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                )
              );
            },
          }}
        />
        <UnplacedFields
          definition={definition}
          selectedFieldId={selectedFieldId}
          onSelectField={onSelectField}
          onPlace={(fieldId) => {
            const first = definition.layout.sections.at(0);
            if (first !== undefined) {
              onMoveField(fieldId, { sectionKey: first.key, beforeId: null });
            }
          }}
        />
      </Stack>
    </DndContext>
  );
};
