import {
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";

/**
 * 拖拉排序的共用設定(dnd-kit;路由頁籤與表單設計器共用):
 * - `usePointerDragSensors`:只有指標感應器(滑鼠、觸控、筆),指標移動超過 `DRAG_START_DISTANCE` 才算拖曳,之內是點擊
 *   (切換頁籤、選取欄位)。鍵盤不走 dnd-kit:頁籤以 Shift+方向鍵搬、設計器以點擊 / 屬性面板操作
 * - `useSortableItem`:`useSortable` + 拖曳中的樣式 `dragSx`(位移、過場、浮到上層、抓取游標、`touchAction: none`)
 * - `dragTranslateOf`:只要位移的(元件面板的 `useDraggable`)
 *
 * `DndContext` 與 `SortableContext`(排序策略、碰撞偵測、無障礙播報)仍由各處自己包:頁籤列是一條橫列、
 * 設計器是多個分區的網格加上外部拖入,差異在那一層。
 */

/** 指標移動超過這個距離才算拖曳(px;之內是點擊)。觸控長按的「移動就取消」也以它為準。 */
export const DRAG_START_DISTANCE = 6;

/** 拖拉排序的感應器:只有指標,移動超過 `DRAG_START_DISTANCE` 才啟動。 */
export const usePointerDragSensors = () =>
  useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: DRAG_START_DISTANCE },
    }),
  );

/** 拖曳中的位移(執行期幾何值,STYLE-01 例外;走 sx 而非 style={},STYLE-02)。 */
export const dragTranslateOf = (
  transform: { x: number; y: number } | null,
): string | undefined =>
  transform
    ? `translate3d(${String(Math.round(transform.x))}px, ${String(Math.round(transform.y))}px, 0)`
    : undefined;

/**
 * 可排序的一項:`useSortable` 的結果加上 `dragSx`(展開進節點的 `sx`)。
 * 節點自己接 `setNodeRef`、`listeners`(指標拖曳)與 `attributes["aria-describedby"]`(拖曳說明);
 * role / tabIndex 由呼叫端決定(頁籤是 `tab`、設計器欄位是 `button`),不展開 dnd-kit 的 `attributes`。
 */
export const useSortableItem = (id: UniqueIdentifier) => {
  const sortable = useSortable({ id });
  const { transform, transition, isDragging } = sortable;
  return {
    ...sortable,
    dragSx: {
      position: "relative",
      touchAction: "none",
      cursor: isDragging ? "grabbing" : "pointer",
      zIndex: isDragging ? 1 : "auto",
      transform: dragTranslateOf(transform),
      transition,
    } as const,
  };
};
