import type {
  FieldDef,
  FormDefinition,
  LayoutCol,
  LayoutSection,
} from "@repo/domain/form";

/**
 * 設計器內部的定義:每個欄位多一個**穩定的內部 id**(`_id`),版面的每一格記它放的是哪個欄位的 `_id`
 * (Spec 6a §5 表 A 下方:「設計器內部以穩定的內部 id 當欄位身分,`key` 只是資料」)。
 *
 * - 載入草稿時配 id(`toDesignDefinition`),輸出(存草稿、JSON 預覽、預覽、未存比對)時丟掉(`toFormDefinition`)
 * - 選取、拖拉、改屬性、刪除一律以 `_id` 找欄位 —— key 重複(舊草稿、改到一半)也不會改錯欄、刪不掉
 * - `DesignField` 是 `FieldDef` 的子型別,所以整份設計定義可以直接交給檢查器與 `FormRenderer`
 */
export interface DesignField extends FieldDef {
  _id: string;
}

export interface DesignCol extends LayoutCol {
  /** 這一格放的欄位的 `_id` */
  _id: string;
}

export interface DesignSection extends Omit<LayoutSection, "rows"> {
  rows: { cols: DesignCol[] }[];
}

export interface DesignDefinition extends Omit<
  FormDefinition,
  "fields" | "layout"
> {
  fields: DesignField[];
  layout: { sections: DesignSection[] };
}

const ID_PREFIX = "f";

/** 下一個沒用過的內部 id(`f<n>`;只在這份設計定義內唯一,不存進定義)。 */
export const nextDesignId = (fields: readonly { _id: string }[]): string => {
  const numbers = fields.map((field) =>
    field._id.startsWith(ID_PREFIX) ? Number(field._id.slice(1)) : 0,
  );
  return `${ID_PREFIX}${String(Math.max(0, ...numbers.filter((value) => Number.isFinite(value))) + 1)}`;
};

/**
 * 載入時配 id:欄位依序 `f1`、`f2`…;版面的每一格對到「同 key 的第 n 個欄位」
 * (key 重複時第一格對第一個、第二格對第二個;多出來的欄位留在「未放置」)。
 */
export const toDesignDefinition = (
  definition: FormDefinition,
): DesignDefinition => {
  const fields = definition.fields.map((field, index) => ({
    ...field,
    _id: `${ID_PREFIX}${String(index + 1)}`,
  }));
  const pending = new Map<string, string[]>();
  for (const field of fields) {
    pending.set(field.key, [...(pending.get(field.key) ?? []), field._id]);
  }
  let orphans = 0;
  const sections = definition.layout.sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => ({
      cols: row.cols.map((col) => {
        const ids = pending.get(col.fieldKey) ?? [];
        const id = ids.at(0);
        if (id === undefined) {
          // 對不到欄位的格子原樣留著(檢查器報 LAYOUT_UNKNOWN_FIELD),給一個不會撞到欄位的 id
          orphans += 1;
          return { ...col, _id: `orphan${String(orphans)}` };
        }
        pending.set(col.fieldKey, ids.slice(1));
        return { ...col, _id: id };
      }),
    })),
  }));
  return { ...definition, fields, layout: { sections } };
};

const withoutId = <Item extends { _id: string }>(
  item: Item,
): Omit<Item, "_id"> => {
  const copy: Partial<Item> = { ...item };
  Reflect.deleteProperty(copy, "_id");
  return copy as Omit<Item, "_id">;
};

/** 輸出:丟掉內部 id,回到 `@repo/domain/form` 的定義形狀(存草稿、JSON 預覽、預覽都用這份)。 */
export const toFormDefinition = (
  definition: DesignDefinition,
): FormDefinition => ({
  ...definition,
  fields: definition.fields.map((field) => withoutId(field)),
  layout: {
    sections: definition.layout.sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) => ({
        cols: row.cols.map((col) => withoutId(col)),
      })),
    })),
  },
});

/** 內部 id(設計定義的欄位 / 版面格才有);一般定義回 undefined,呼叫端退回用 key。 */
export const designIdOf = (item: object): string | undefined =>
  "_id" in item && typeof item._id === "string" ? item._id : undefined;
