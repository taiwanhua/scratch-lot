import { type PointerEvent, useEffect, useRef } from "react";

/** 按住多久算長按(ms)。 */
export const LONG_PRESS_MS = 500;

export interface LongPressPoint {
  x: number;
  y: number;
}

export interface LongPressHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  /** 剛剛是不是長按(讀一次就清掉):長按後放開手指時瀏覽器還會補一個 click,呼叫端用它把那次點擊吃掉 */
  consumeLongPress: () => boolean;
}

/**
 * 觸控長按(滑鼠不算,滑鼠用右鍵):按住不動 `LONG_PRESS_MS` 才觸發;移動超過 `moveTolerance`(px)就取消,
 * 讓同一個門檻的拖曳(dnd-kit 的 `activationConstraint.distance`)照常啟動,兩者不會同時發生。
 */
export const useLongPress = (
  onLongPress: (point: LongPressPoint) => void,
  moveTolerance: number,
): LongPressHandlers => {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<LongPressPoint | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  };

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  return {
    onPointerDown: (event) => {
      fired.current = false;
      cancel();
      if (event.pointerType === "mouse") {
        return;
      }
      const point = { x: event.clientX, y: event.clientY };
      start.current = point;
      timer.current = setTimeout(() => {
        timer.current = null;
        start.current = null;
        fired.current = true;
        onLongPress(point);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event) => {
      const origin = start.current;
      if (
        origin !== null &&
        Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >
          moveTolerance
      ) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    consumeLongPress: () => {
      const wasLongPress = fired.current;
      fired.current = false;
      return wasLongPress;
    },
  };
};
