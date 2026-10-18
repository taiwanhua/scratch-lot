/** 畫面上同時最多幾則提示。 */
export const SNACKBAR_MAX_VISIBLE = 3;

/**
 * 把新的一則放進佇列:**往上疊、新的在最後(畫面最下面)**;超過 `max` 時從最舊的開始丟,
 * 第 4 則出現時最舊的那則消失、畫面上維持 3 則。不分操作結果 / 可撤銷 / 新通知,一律同一個佇列。
 *
 * 純函式:app 的 store 用它更新狀態,`SnackbarStack` 不再另做截斷以外的判斷。
 */
export const enqueueSnackbar = <TItem>(
  items: readonly TItem[],
  item: TItem,
  max: number = SNACKBAR_MAX_VISIBLE,
): TItem[] => [...items, item].slice(-max);
