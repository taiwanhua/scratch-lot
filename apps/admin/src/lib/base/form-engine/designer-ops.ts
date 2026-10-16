import {
  ARRAY_COLUMN_WIDGETS,
  type ArrayColumnDef,
  type ArrayColumnType,
  DEFAULT_WIDGET_REGISTRY,
  type FieldDef,
  type FieldKeyCheck,
  type FieldType,
  LAYOUT_COLUMNS,
  type LayoutCol,
  checkFieldKey,
} from "@repo/domain/form";

import type {
  DesignCol,
  DesignDefinition,
  DesignField,
  DesignSection,
} from "./design-definition";

/**
 * 設計器對草稿定義的操作(純函式,設計器與測試共用;Spec 6a §5、§8「設計器其他規則」)。
 *
 * **欄位的身分是內部 id(`_id`,見 `design-definition.ts`)**,不是 key:選取、拖拉、改屬性、刪除都以 id
 * 找欄位,所以 key 重複或改到一半也不會改錯欄、刪不掉。版面以「每個分區一串欄位」操作:拖拉只改順序與
 * 所屬分區,列(`rows`)依 `span` 由左而右重新裝箱(一列加總不超過 12 格),所以拖拉之後不會出現超過 12 格的列。
 *
 * **刪欄位只動草稿的 `fields[]` 與 `layout`**:公式、條件、摘要槽、帶入規則若還引用它,
 * 就變成檢查器錯誤(定位到引用處)由設計者手動修,這裡不自動改、不自動清。
 */

export const DEFAULT_SPAN = 6;

/** 放進版面時的寬度:明細列固定占滿 12 格(檢查器 `ARRAY_SPAN`),其餘預設半寬。 */
export const initialSpanOf = (field: Pick<FieldDef, "type">): number =>
  field.type === "array" ? LAYOUT_COLUMNS : DEFAULT_SPAN;

/** 新的子欄(元件取該型別白名單的第一個;數字 0 位小數;單選是空的靜態清單)。 */
export const newColumnOf = (
  type: ArrayColumnType,
  key: string,
  label: string,
): ArrayColumnDef => ({
  key,
  label,
  type,
  ...(type === "number" && { precision: 0 }),
  widget: { kind: ARRAY_COLUMN_WIDGETS[type][0] ?? "textField" },
  valueSource: { kind: "input" },
  ...(type === "select" && { options: { kind: "static", items: [] } }),
  rules: { required: false },
});

/** 分區裡的欄位(依版面順序)。 */
export const sectionCols = (section: DesignSection): DesignCol[] =>
  section.rows.flatMap((row) => row.cols);

/** 一串欄位依 span 裝箱成列。 */
export const packRows = <Col extends LayoutCol>(
  cols: readonly Col[],
): { cols: Col[] }[] => {
  const rows: { cols: Col[] }[] = [];
  let current: Col[] = [];
  let used = 0;
  for (const col of cols) {
    if (current.length > 0 && used + col.span > LAYOUT_COLUMNS) {
      rows.push({ cols: current });
      current = [];
      used = 0;
    }
    current.push(col);
    used += col.span;
  }
  if (current.length > 0) {
    rows.push({ cols: current });
  }
  return rows;
};

const withSectionCols = (
  section: DesignSection,
  cols: readonly DesignCol[],
): DesignSection => ({ ...section, rows: packRows(cols) });

/** 下一個沒用過的 key(`<prefix>_<n>`)。 */
export const nextKey = (prefix: string, used: Iterable<string>): string => {
  const taken = new Set(used);
  let index = 1;
  while (taken.has(`${prefix}_${String(index)}`)) {
    index += 1;
  }
  return `${prefix}_${String(index)}`;
};

/**
 * 新欄位的預設定義(widget 取該型別登錄表的第一個)。明細列預設一個文字子欄(`columnLabel` 是它的標題),
 * 至少一個子欄才過檢查器。
 */
export const newFieldOf = (
  type: FieldType,
  key: string,
  label: string,
  columnLabel = label,
): FieldDef => ({
  key,
  label,
  type,
  ...(type === "number" && { precision: 0 }),
  widget: { kind: DEFAULT_WIDGET_REGISTRY[type][0] ?? "textField" },
  valueSource: { kind: "input" },
  options:
    type === "select" || type === "multiSelect"
      ? { kind: "static", items: [] }
      : null,
  rules: { required: false },
  permission: { show: false, edit: false },
  help: null,
  ...(type === "array" && {
    columns: [newColumnOf("text", "item", columnLabel)],
  }),
});

export interface PlaceTarget {
  sectionKey: string;
  /** 放在這個欄位(內部 id)前面;null = 放在分區最後 */
  beforeId: string | null;
}

const placeCol = (
  sections: readonly DesignSection[],
  col: DesignCol,
  target: PlaceTarget,
): DesignSection[] =>
  sections.map((section) => {
    if (section.key !== target.sectionKey) {
      return section;
    }
    const cols = sectionCols(section);
    const index =
      target.beforeId === null
        ? -1
        : cols.findIndex((item) => item._id === target.beforeId);
    const next =
      index === -1
        ? [...cols, col]
        : [...cols.slice(0, index), col, ...cols.slice(index)];
    return withSectionCols(section, next);
  });

const withoutCol = (
  sections: readonly DesignSection[],
  fieldId: string,
): DesignSection[] =>
  sections.map((section) =>
    withSectionCols(
      section,
      sectionCols(section).filter((col) => col._id !== fieldId),
    ),
  );

const mapCol = (
  definition: DesignDefinition,
  fieldId: string,
  update: (col: DesignCol) => DesignCol,
): DesignDefinition["layout"] => ({
  sections: definition.layout.sections.map((section) =>
    withSectionCols(
      section,
      sectionCols(section).map((col) =>
        col._id === fieldId ? update(col) : col,
      ),
    ),
  ),
});

const colOf = (
  sections: readonly DesignSection[],
  fieldId: string,
): DesignCol | undefined =>
  sections
    .flatMap((section) => sectionCols(section))
    .find((col) => col._id === fieldId);

/** 以內部 id 找欄位。 */
export const fieldById = (
  definition: DesignDefinition,
  fieldId: string | null,
): DesignField | undefined =>
  fieldId === null
    ? undefined
    : definition.fields.find((field) => field._id === fieldId);

export const addField = (
  definition: DesignDefinition,
  field: DesignField,
  target: PlaceTarget | null,
): DesignDefinition => {
  const col = {
    fieldKey: field.key,
    span: initialSpanOf(field),
    _id: field._id,
  };
  return {
    ...definition,
    fields: [...definition.fields, field],
    layout: {
      sections:
        target === null
          ? definition.layout.sections
          : placeCol(definition.layout.sections, col, target),
    },
  };
};

/** 拖拉:移到某分區的某欄之前(或分區最後);欄寬沿用。沒放進版面的欄位從「未放置」拉進來也走這裡。 */
export const moveField = (
  definition: DesignDefinition,
  fieldId: string,
  target: PlaceTarget,
): DesignDefinition => {
  const field = fieldById(definition, fieldId);
  if (target.beforeId === fieldId || field === undefined) {
    return definition;
  }
  const col = colOf(definition.layout.sections, fieldId) ?? {
    fieldKey: field.key,
    span: initialSpanOf(field),
    _id: fieldId,
  };
  const sections = withoutCol(definition.layout.sections, fieldId);
  return {
    ...definition,
    layout: { sections: placeCol(sections, col, target) },
  };
};

/** 只從草稿的 `fields[]` 與 `layout` 移除;引用處不動(Spec §5「草稿裡刪欄位」)。 */
export const removeField = (
  definition: DesignDefinition,
  fieldId: string,
): DesignDefinition => ({
  ...definition,
  fields: definition.fields.filter((field) => field._id !== fieldId),
  layout: { sections: withoutCol(definition.layout.sections, fieldId) },
});

/** 改一個欄位的定義(以內部 id 找);改 key 時版面跟著改(公式等引用不改 —— 變成檢查器錯誤)。 */
export const updateField = (
  definition: DesignDefinition,
  fieldId: string,
  next: FieldDef,
): DesignDefinition => ({
  ...definition,
  fields: definition.fields.map((field) =>
    field._id === fieldId ? { ...next, _id: fieldId } : field,
  ),
  layout: mapCol(definition, fieldId, (col) => ({
    ...col,
    fieldKey: next.key,
  })),
});

export const setFieldSpan = (
  definition: DesignDefinition,
  fieldId: string,
  span: number,
): DesignDefinition => ({
  ...definition,
  layout: mapCol(definition, fieldId, (col) => ({ ...col, span })),
});

export const spanOf = (
  definition: DesignDefinition,
  fieldId: string,
): number | null => colOf(definition.layout.sections, fieldId)?.span ?? null;

/** 改 key 被擋的原因:格式不符 / 保留字 / 與別的欄位重複。 */
export type FieldKeyProblem =
  Extract<FieldKeyCheck, { valid: false }>["reason"] | "duplicate";

/**
 * 改 key 當場擋(Spec 6a §5 表 A 下方:「改 `key` 時當場擋重複與格式錯誤,不等檢查器」):
 * 回 null = 可以寫入;否則回原因,呼叫端標紅、不寫入。
 */
export const fieldKeyProblemOf = (
  definition: DesignDefinition,
  fieldId: string,
  key: string,
): FieldKeyProblem | null => {
  const check = checkFieldKey(key);
  if (!check.valid) {
    return check.reason;
  }
  return definition.fields.some(
    (field) => field._id !== fieldId && field.key === key,
  )
    ? "duplicate"
    : null;
};

export const addSection = (
  definition: DesignDefinition,
  title: string,
): DesignDefinition => ({
  ...definition,
  layout: {
    sections: [
      ...definition.layout.sections,
      {
        key: nextKey(
          "section",
          definition.layout.sections.map((section) => section.key),
        ),
        title,
        rows: [],
      },
    ],
  },
});

export const renameSection = (
  definition: DesignDefinition,
  sectionKey: string,
  title: string,
): DesignDefinition => ({
  ...definition,
  layout: {
    sections: definition.layout.sections.map((section) =>
      section.key === sectionKey ? { ...section, title } : section,
    ),
  },
});

/** 刪分區二選一:欄位移到「未放置」(`unplace`),或連同欄位刪除(`withFields`)。 */
export type RemoveSectionMode = "unplace" | "withFields";

export const removeSection = (
  definition: DesignDefinition,
  sectionKey: string,
  mode: RemoveSectionMode,
): DesignDefinition => {
  const section = definition.layout.sections.find(
    (candidate) => candidate.key === sectionKey,
  );
  if (section === undefined) {
    return definition;
  }
  const removed = new Set(sectionCols(section).map((col) => col._id));
  return {
    ...definition,
    fields:
      mode === "withFields"
        ? definition.fields.filter((field) => !removed.has(field._id))
        : definition.fields,
    layout: {
      sections: definition.layout.sections.filter(
        (candidate) => candidate.key !== sectionKey,
      ),
    },
  };
};

/** 還沒放進版面的欄位(`constant` 可以不放,不列)。 */
export const unplacedFields = (definition: DesignDefinition): DesignField[] => {
  const placed = new Set(
    definition.layout.sections.flatMap((section) =>
      sectionCols(section).map((col) => col._id),
    ),
  );
  return definition.fields.filter(
    (field) => !placed.has(field._id) && field.valueSource.kind !== "constant",
  );
};
