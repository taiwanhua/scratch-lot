import { useMemo, useState } from "react";

import {
  DEFAULT_WIDGET_REGISTRY,
  type FieldDef,
  type FieldType,
  type FormDefinition,
  validateDefinition,
} from "@repo/domain/form";

import {
  type DesignDefinition,
  nextDesignId,
  toDesignDefinition,
  toFormDefinition,
} from "@/lib/base/form-engine/design-definition";
import type { DesignerReport } from "@/lib/base/form-engine/designer-issues";
import {
  type PlaceTarget,
  type RemoveSectionMode,
  addField,
  addSection,
  moveField,
  newFieldOf,
  nextKey,
  removeField,
  removeSection,
  renameSection,
  setFieldSpan,
  updateField,
} from "@/lib/base/form-engine/designer-ops";

import { type RegexCheckStatus, useRegexSafety } from "./useRegexSafety";

/** 表單層設定(摘要槽、帶入規則)的一次修改。 */
export type DefinitionSettingsPatch = Partial<
  Pick<FormDefinition, "summaryMap" | "prefills">
>;

export interface DesignerState {
  /** 設計器內部的定義(欄位帶內部 id `_id`) */
  definition: DesignDefinition;
  /** 輸出形狀(丟掉內部 id):存草稿、JSON 預覽、預覽用 */
  output: FormDefinition;
  isDirty: boolean;
  /** 前端即時檢查器(Spec 6a §5:設計器即時 + 發布時 api 再跑) */
  report: DesignerReport;
  /** 正則即時檢查的狀態(檢查結果區塊顯示「正則檢查中」/ 載入失敗的警告) */
  regexStatus: RegexCheckStatus;
  /** 選中欄位的內部 id */
  selectedFieldId: string | null;
  select: (fieldId: string | null) => void;
  /** 依 key 選(檢查結果定位只知道 key;重複時選第一個) */
  selectByKey: (fieldKey: string | null) => void;
  /**
   * 新增欄位:`target` 為 null = 放在第一個分區最後;還沒有任何分區時先建一個(`sectionTitle`)。
   */
  add: (
    type: FieldType,
    label: string,
    target: PlaceTarget | null,
    sectionTitle: string,
    /** 明細列預設子欄的標題 */
    columnLabel?: string,
  ) => void;
  move: (fieldId: string, target: PlaceTarget) => void;
  remove: (fieldId: string) => void;
  update: (fieldId: string, next: FieldDef) => void;
  setSpan: (fieldId: string, span: number) => void;
  addSection: (title: string) => void;
  renameSection: (sectionKey: string, title: string) => void;
  removeSection: (sectionKey: string, mode: RemoveSectionMode) => void;
  patchSettings: (patch: DefinitionSettingsPatch) => void;
  /** 存草稿成功後把**送出去的那一份**當成新的基準(存檔途中又改的仍算未存) */
  markSaved: (saved: FormDefinition) => void;
}

/**
 * 設計器的草稿狀態(初始值由外層 gate 後帶進 `useState` 初始化器,REACT-08)。
 * 載入時給每個欄位配內部 id(`design-definition.ts`),所有改動都走 `lib/base/form-engine/designer-ops.ts`
 * 的純函式、以 id 找欄位;**刪欄位只動草稿**,引用處交給檢查器報錯。
 */
export const useDesignerState = (initial: FormDefinition): DesignerState => {
  const [definition, setDefinition] = useState(() =>
    toDesignDefinition(initial),
  );
  const [saved, setSaved] = useState(initial);
  const [selectedFieldId, select] = useState<string | null>(null);
  const output = useMemo(() => toFormDefinition(definition), [definition]);
  const { regexSafety, status: regexStatus } = useRegexSafety(output);

  const report = useMemo(
    () =>
      validateDefinition(output, {
        widgets: DEFAULT_WIDGET_REGISTRY,
        regexSafety,
      }),
    [output, regexSafety],
  );

  return {
    definition,
    output,
    isDirty: JSON.stringify(output) !== JSON.stringify(saved),
    report,
    regexStatus,
    selectedFieldId,
    select,
    selectByKey: (fieldKey) => {
      select(
        definition.fields.find((field) => field.key === fieldKey)?._id ?? null,
      );
    },
    add: (type, label, target, sectionTitle, columnLabel) => {
      const key = nextKey(
        "field",
        definition.fields.map((field) => field.key),
      );
      const id = nextDesignId(definition.fields);
      const base =
        target === null && definition.layout.sections.length === 0
          ? addSection(definition, sectionTitle)
          : definition;
      const firstSection = base.layout.sections.at(0);
      const place =
        target ??
        (firstSection === undefined
          ? null
          : { sectionKey: firstSection.key, beforeId: null });
      setDefinition(
        addField(
          base,
          { ...newFieldOf(type, key, label, columnLabel), _id: id },
          place,
        ),
      );
      select(id);
    },
    move: (fieldId, target) => {
      setDefinition(moveField(definition, fieldId, target));
    },
    remove: (fieldId) => {
      setDefinition(removeField(definition, fieldId));
      select(null);
    },
    update: (fieldId, next) => {
      setDefinition(updateField(definition, fieldId, next));
    },
    setSpan: (fieldId, span) => {
      setDefinition(setFieldSpan(definition, fieldId, span));
    },
    addSection: (title) => {
      setDefinition(addSection(definition, title));
    },
    renameSection: (sectionKey, title) => {
      setDefinition(renameSection(definition, sectionKey, title));
    },
    removeSection: (sectionKey, mode) => {
      setDefinition(removeSection(definition, sectionKey, mode));
    },
    patchSettings: (patch) => {
      setDefinition({ ...definition, ...patch });
    },
    markSaved: (snapshot) => {
      setSaved(snapshot);
    },
  };
};
