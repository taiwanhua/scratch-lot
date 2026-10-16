import { type RefObject, useLayoutEffect, useRef } from "react";

export interface AutoScrollOptions {
  /** 顯示範圍(模式 + 日期);換了就重新捲 */
  rangeKey: string;
  /** 顯示範圍內有沒有容器 / 長條 */
  hasData: boolean;
  /** 要捲到的位置(px,時間方向) */
  offset: number;
  /** 時間方向:日模式橫向、週模式直向 */
  axis: "x" | "y";
}

/**
 * 進入畫面(或切換日期 / 週)時捲到指定位置(《底座規格》10.11)。同一個範圍只捲一次,
 * 之後資料變動(新增一筆排班…)不搶走使用者的捲動位置;例外是先以「沒有資料」捲到 08:00、
 * 資料隨後才到的情況,資料一到再捲一次。
 */
export const useAutoScroll = (
  ref: RefObject<HTMLElement | null>,
  { rangeKey, hasData, offset, axis }: AutoScrollOptions,
) => {
  const last = useRef<{ rangeKey: string; hasData: boolean } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const previous = last.current;
    if (
      previous !== null &&
      previous.rangeKey === rangeKey &&
      (previous.hasData || !hasData)
    ) {
      return;
    }
    last.current = { rangeKey, hasData };
    if (axis === "x") {
      element.scrollLeft = offset;
    } else {
      element.scrollTop = offset;
    }
  }, [ref, rangeKey, hasData, offset, axis]);
};
