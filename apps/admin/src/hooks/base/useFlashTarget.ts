import { useCallback, useState } from "react";

/** 要閃的目標 + 這一次的序號(每次 `flash` 都換;當元件的 `key` 用,同一個目標再閃也會重播動畫)。 */
export type FlashTarget<T extends object> = T & { nonce: number };

export interface FlashTargetState<T extends object> {
  /** 目前要閃的目標;還沒閃過或清掉後 = null。 */
  target: FlashTarget<T> | null;
  /** 讓這個目標閃一下(例:刷到某一格、剛加進清單的那一列)。 */
  flash: (next: T) => void;
  /** 不再標示任何目標。 */
  clear: () => void;
}

/**
 * 閃爍提示的狀態:記下「要閃哪一個」與遞增序號。畫面上的元件以 `target.nonce` 當 `key` 重掛,
 * 並套 `FLASH_HIGHLIGHT_SX`(`lib/base/flash-highlight.ts`),同一個目標連續觸發也會每次都閃。
 *
 * ```tsx
 * const { target, flash } = useFlashTarget<{ rowId: string }>();
 * // 掃到 → flash({ rowId });
 * <Row key={target?.rowId === row.id ? target.nonce : undefined}
 *      sx={target?.rowId === row.id ? FLASH_HIGHLIGHT_SX : undefined} />
 * ```
 */
export const useFlashTarget = <T extends object>(): FlashTargetState<T> => {
  const [target, setTarget] = useState<FlashTarget<T> | null>(null);
  const flash = useCallback((next: T) => {
    setTarget((current) => ({ ...next, nonce: (current?.nonce ?? 0) + 1 }));
  }, []);
  const clear = useCallback(() => {
    setTarget(null);
  }, []);
  return { target, flash, clear };
};
