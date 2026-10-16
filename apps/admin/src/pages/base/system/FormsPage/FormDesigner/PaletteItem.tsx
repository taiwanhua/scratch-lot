import { useDraggable } from "@dnd-kit/core";

import type { FieldType } from "@repo/domain/form";
import { Button } from "@repo/ui/button";

import { paletteId } from "@/lib/base/form-engine/design-ids";

export interface PaletteItemProps {
  type: FieldType;
  label: string;
  addLabel: string;
  onAdd: (type: FieldType) => void;
}

/**
 * 元件面板的一個欄位型別:拖進畫布(放在某欄之前或分區最後)或直接點(加到第一個分區最後)。
 * 點擊這條路讓鍵盤與測試不必靠拖拉(jsdom 沒有版面幾何)。
 */
export const PaletteItem = ({
  type,
  label,
  addLabel,
  onAdd,
}: PaletteItemProps) => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: paletteId(type),
  });

  return (
    <Button
      ref={setNodeRef}
      variant="outlined"
      size="small"
      aria-label={addLabel}
      aria-describedby={attributes["aria-describedby"]}
      onClick={() => {
        onAdd(type);
      }}
      {...listeners}
      sx={{
        justifyContent: "flex-start",
        touchAction: "none",
        // 拖曳中的位移是執行期幾何值(STYLE-01 例外,同 RouteTabs 的 SortableTab)
        transform: transform
          ? `translate3d(${String(Math.round(transform.x))}px, ${String(Math.round(transform.y))}px, 0)`
          : undefined,
      }}
    >
      {label}
    </Button>
  );
};
