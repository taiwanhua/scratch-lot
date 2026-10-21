/* eslint-disable react-refresh/only-export-components -- 測試替身:同一檔同時匯出替身元件與「取代整個模組」的物件,只在 jest 內載入、不走 Vite HMR;dnd-kit 換掉時整檔一起刪 */
import { act } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";

/**
 * dnd-kit 的測試替身:jsdom 沒有版面幾何,真的指標拖曳測不出「放到哪」;
 * 這裡把 `DndContext` 換成只記住 `onDragStart` / `onDragEnd` 的空殼,測試以 `dragStart(active)` / `dragEnd(active, over)` 直接送出拖曳事件,
 * 其餘(排序策略、`useSortable`)都退化成不動作。用法見 `app/AdminShell/RouteTabs/RouteTabs.drag.test.tsx`
 * (`jest.unstable_mockModule` 必須在動態 import 受測模組之前)。
 */

interface DragEndEventLike {
  active: { id: string };
  over: { id: string } | null;
}

type DragEndHandler = (event: DragEndEventLike) => void;
type DragStartHandler = (event: { active: { id: string } }) => void;

let latestOnDragEnd: DragEndHandler | null = null;
let latestOnDragStart: DragStartHandler | null = null;

interface DndContextDoubleProps {
  children?: ReactNode;
  onDragStart?: DragStartHandler;
  onDragEnd?: DragEndHandler;
}

const DndContext = ({
  children,
  onDragStart,
  onDragEnd,
}: DndContextDoubleProps) => {
  useEffect(() => {
    latestOnDragEnd = onDragEnd ?? null;
    latestOnDragStart = onDragStart ?? null;
  });
  return <>{children}</>;
};

const SortableContext = ({ children }: { children?: ReactNode }) => (
  <>{children}</>
);

const useSortable = () => ({
  attributes: {},
  listeners: {},
  setNodeRef: () => {
    // 替身不量測節點
  },
  transform: null,
  transition: undefined,
  isDragging: false,
});

/** 可拖來源 / 放置目標的替身(設計器的元件面板與分區放置區用):都不量測、不動作。 */
const useDraggable = () => ({
  attributes: {},
  listeners: {},
  setNodeRef: () => {
    // 替身不量測節點
  },
  transform: null,
  isDragging: false,
});

const useDroppable = () => ({
  setNodeRef: () => {
    // 替身不量測節點
  },
  isOver: false,
});

/** 模擬使用者拿起 `activeId`(指標移動超過拖曳門檻、拖曳啟動)。 */
export const dragStart = (activeId: string): void => {
  act(() => {
    latestOnDragStart?.({ active: { id: activeId } });
  });
};

/** 模擬使用者把 `activeId` 拖到 `overId` 的位置放下。 */
export const dragEnd = (activeId: string, overId: string | null): void => {
  act(() => {
    latestOnDragEnd?.({
      active: { id: activeId },
      over: overId === null ? null : { id: overId },
    });
  });
};

/** 取代 `@dnd-kit/core` 的模組物件 */
export const dndKitCoreDouble = {
  DndContext,
  PointerSensor: () => null,
  closestCenter: () => [],
  useSensor: () => ({}),
  useSensors: () => [],
  useDraggable,
  useDroppable,
};

/** 取代 `@dnd-kit/sortable` 的模組物件 */
export const dndKitSortableDouble = {
  SortableContext,
  horizontalListSortingStrategy: () => null,
  rectSortingStrategy: () => null,
  verticalListSortingStrategy: () => null,
  useSortable,
};
