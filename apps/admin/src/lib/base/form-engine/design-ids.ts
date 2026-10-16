/**
 * 設計器畫布的 dnd-kit id(拖拉來源與放置目標共用一套命名,設計器的 `onDragEnd` 以前綴分辨):
 * - `field:<fieldKey>`:畫布上的欄位(可拖、可放在它前面)
 * - `section:<sectionKey>`:分區尾端的放置區(放在分區最後;空分區也拖得進來)
 * - `palette:<type>`:元件面板的欄位型別(拖進畫布 = 新增一個該型別的欄位)
 */
export const designFieldId = (fieldKey: string): string => `field:${fieldKey}`;

export const sectionDropId = (sectionKey: string): string =>
  `section:${sectionKey}`;

export const paletteId = (type: string): string => `palette:${type}`;

const DESIGN_KINDS = ["field", "section", "palette"] as const;

export type DesignDragKind = (typeof DESIGN_KINDS)[number];

export interface DesignDragTarget {
  kind: DesignDragKind;
  key: string;
}

const isDesignKind = (kind: string): kind is DesignDragKind =>
  (DESIGN_KINDS as readonly string[]).includes(kind);

export const parseDesignId = (id: string): DesignDragTarget | null => {
  const separator = id.indexOf(":");
  if (separator === -1) {
    return null;
  }
  const kind = id.slice(0, separator);
  const key = id.slice(separator + 1);
  return isDesignKind(kind) ? { kind, key } : null;
};
